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

        await this.prisma.$transaction(async (tx) => {
            let user = await tx.user.findUnique({
                where: { tgId },
                select: { tgId: true },
            });

            if (!user) {
                if (invited_by) {
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

                    await tx.user.update({
                        where: { tgId: invited_by },
                        data: {
                            balance: { increment: 70 }
                        }
                    })

                    await tx.reward.create({
                        data: {
                            userId: invited_by,
                            meaning: 70,
                            reward_type: 'unique'
                        },
                    });
    
                    await tx.reward.create({
                        data: {
                            userId: tgId,
                            meaning: 120,
                            reward_type: 'enter'
                        },
                    });
                } else {
                    await tx.user.create({
                        data: {
                            tgId,
                            username: parseData.user.firstName,
                            photo_url: parseData.user.photoUrl,
                            is_premium: parseData.user.isPremium,
                            language: parseData.user.languageCode,
                            ip_address: clientIp,
                        },
                        select: { tgId: true },
                    });
    
                    await tx.reward.create({
                        data: {
                            userId: tgId,
                            meaning: 120,
                            reward_type: 'enter'
                        },
                    });
                }

            } else {
                await tx.user.update({
                    where: { tgId },
                    data: { ip_address: clientIp },
                });
            }
        })

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
