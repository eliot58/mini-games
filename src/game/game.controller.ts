import { Controller, Get, NotFoundException, Req, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RequestWithAuth } from '../auth/auth.types';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '../auth/auth.guard';
import { randomBytes } from 'crypto';
import { firstValueFrom } from 'rxjs';
import { HttpService } from '@nestjs/axios';

@Controller('game')
export class GameController {
    constructor(
        private readonly prisma: PrismaService,
        private readonly httpService: HttpService,
        private readonly configService: ConfigService
    ) { }

    @Get('getShareMessage')
    @UseGuards(AuthGuard)
    async getShareMessage(@Req() request: RequestWithAuth) {
        const BOT_TOKEN = this.configService.get<string>('BOT_TOKEN');
        const API_URL = `https://api.telegram.org/bot${BOT_TOKEN}/savePreparedInlineMessage`;
        const userId = request.tgId;

        const user = await this.prisma.user.findUnique({ where: { tgId: userId }})

        if (!user) throw new NotFoundException("User not found")

        if (!user.current_game) throw new NotFoundException("Current game not found")

        const game = await this.prisma.game.findUnique({ where: { id: user.current_game }})

        if (!game) throw new NotFoundException("Game not found")
        
        const result = JSON.stringify({
            type: "article",
            id: randomBytes(5).toString("hex"),
            title: `Invitation to the game!`,
            thumbnail_url: "https://ipfs.io/ipfs/bafkreidmkchryuy533s6vfcfsndjajnie2czaa64bp6sygz7zs4wksqbbq",
            thumbnail_width: 300,
            thumbnail_height: 300,
            input_message_content: {
                message_text: `Invitation to the game \n \n ${user.username}`
            },
            reply_markup: {
                inline_keyboard: [[{ text: "Play Tac Tic", url: `https://t.me/TacTicToe_bot?startapp=lobby_${user.current_game}__ref=${userId}` }]]
            }
        });
        
        const url = `${API_URL}?user_id=${userId}&result=${encodeURIComponent(result)}&allow_user_chats=true&allow_group_chats=true`;
        
        try {
            const response = await firstValueFrom(this.httpService.get(url));
            if (response.data.ok && response.data.result) {
                return { messageId: response.data.result.id };
            } else {
                return { error: response.data };
            }
        } catch (error) {
            return { error: error.message };
        }
    }
}
