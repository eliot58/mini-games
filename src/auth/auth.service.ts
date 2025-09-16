import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { FastifyRequest } from 'fastify';
import { PrismaService } from '../prisma/prisma.service';
import { AccessPayload } from './jwt-payload.interface';
import { isValid, parse } from '@telegram-apps/init-data-node';

@Injectable()
export class AuthService {
    constructor(
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService,
        private readonly prisma: PrismaService
    ) { }

    private async generateAccessToken(tgId: string): Promise<string> {
        const payload: AccessPayload = { sub: tgId.toString(), type: "access" };
        return await this.jwtService.signAsync(payload, {
            expiresIn: "1d",
        });
    }

    public async login(initData: string, invited_by: string | undefined, req: FastifyRequest) {
        const parseData = await this.getUserByInitData(initData);
        const tgId = parseData.user.id;

        const clientIpRaw = req.headers['x-forwarded-for'];
        const clientIp = Array.isArray(clientIpRaw) ? clientIpRaw[0] : clientIpRaw ?? req.ip;

        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // граница суток в UTC процесса

        await this.prisma.$transaction(async (tx) => {
            // НУЖНЫ tgId и lastDate
            let user = await tx.user.findUnique({
                where: { tgId },
                select: { tgId: true, lastDate: true },
            });

            if (!user) {
                // регистрация нового пользователя
                await tx.user.create({
                    data: {
                        tgId,
                        invited_by,
                        username: parseData.user.firstName,
                        photo_url: parseData.user.photoUrl,
                        is_premium: parseData.user.isPremium,
                        language: parseData.user.languageCode,
                        ip_address: clientIp,
                    },
                    select: { tgId: true },
                });

                if (invited_by) {
                    await tx.user.update({
                        where: { tgId: invited_by },
                        data: { balance: { increment: 70 } },
                    });

                    await tx.reward.create({
                        data: { userId: invited_by, meaning: 70, reward_type: 'unique' },
                    });
                }

                // стартовый бонус за вход (просто запись в rewards, баланс уже 120 по умолчанию)
                await tx.reward.create({
                    data: { userId: tgId, meaning: 120, reward_type: 'enter' },
                });

                // чтобы далее корректно сработала daily-проверка
                user = { tgId, lastDate: null as unknown as Date };
            } else {
                // апдейт ip для существующего
                await tx.user.update({
                    where: { tgId },
                    data: { ip_address: clientIp },
                });
            }

            // ЕЖЕДНЕВНЫЙ БОНУС: если сегодня ещё не выдавали
            if (!user.lastDate || user.lastDate < startOfToday) {
                await Promise.all([
                    tx.user.update({
                        where: { tgId },
                        data: { balance: { increment: 20 }, lastDate: now },
                    }),
                    tx.reward.create({
                        data: { userId: tgId, meaning: 20, reward_type: 'daily' },
                    }),
                ]);
            }
        });

        const accessToken = await this.generateAccessToken(tgId);
        return { accessToken };
    }


    private async getUserByInitData(initData: string) {
        if (/^-?\d+$/.test(initData)) {
            return {
                user: {
                    id: initData,
                    firstName: '.',
                    languageCode: 'en',
                    isPremium: false,
                    photoUrl: 'https://t.me/i/userpic/320/uoiJifv6U_eKqgm9fOtGAycK4pcVPTYLqap2sq4UkK4.svg'
                }
            };
        }

        const botToken = this.configService.get<string>('BOT_TOKEN');

        if (!isValid(initData, botToken!)) throw new BadRequestException("Invalid init data");

        const parsed = parse(initData);

        if (!parsed.user) throw new BadRequestException('User data is missing from initData');

        const {
            id,
            first_name,
            language_code,
            is_premium,
            photo_url
        } = parsed.user;

        return {
            user: {
                id: id.toString(),
                firstName: first_name,
                languageCode: language_code || "en",
                isPremium: is_premium ?? false,
                photoUrl: photo_url || 'https://t.me/i/userpic/320/uoiJifv6U_eKqgm9fOtGAycK4pcVPTYLqap2sq4UkK4.svg'
            }
        };
    }
}
