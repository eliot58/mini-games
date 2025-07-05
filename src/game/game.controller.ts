import {
  BadRequestException,
  Controller,
  Get,
  InternalServerErrorException,
  NotFoundException,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
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
    private readonly configService: ConfigService,
  ) {}

  public async createInvoiceLink({
    title,
    description,
    payload,
    photo_url,
    currency,
    prices,
  }: {
    title: string;
    description: string;
    payload: string;
    photo_url: string;
    currency: string;
    prices: { label: string; amount: number }[];
  }): Promise<string> {
    const botToken = this.configService.get<string>('BOT_TOKEN');
    const apiUrl = `https://api.telegram.org/bot${botToken}/createInvoiceLink`;

    try {
      const response = await firstValueFrom(
        this.httpService.get(apiUrl, {
          params: {
            title,
            description,
            payload,
            photo_url,
            currency,
            prices: JSON.stringify(prices),
          },
        }),
      );

      if (response.data?.ok) {
        return response.data.result;
      } else {
        throw new BadRequestException(
          `Oops! Something went wrong on our end. Please try again later: ${response.data?.description || 'Unknown error'}`,
        );
      }
    } catch (error) {
      throw new InternalServerErrorException(
        `Oops! Something went wrong on our end. Please try again later: ${error.message || error}`,
      );
    }
  }

  @Get('getShareMessage')
  @UseGuards(AuthGuard)
  async getShareMessage(@Req() request: RequestWithAuth) {
    const BOT_TOKEN = this.configService.get<string>('BOT_TOKEN');
    const API_URL = `https://api.telegram.org/bot${BOT_TOKEN}/savePreparedInlineMessage`;
    const userId = request.tgId;

    const user = await this.prisma.user.findUnique({ where: { tgId: userId } });

    if (!user) throw new NotFoundException('User not found');

    if (!user.current_game)
      throw new NotFoundException('Current game not found');

    const game = await this.prisma.game.findUnique({
      where: { id: user.current_game },
    });

    if (!game) throw new NotFoundException('Game not found');

    let message_text = '';

    if (game.gameType === 'xo') {
      if (game.winLines === 5) {
        message_text = `
                    XO X5:\n
                    ${user.username} invites you to join the endless game of Tic-tac-toe.\n
                    Winning condition: five in a row.
                `;
      } else {
        message_text = `
                    XO X6:\n
                    ${user.username} invites you to join the endless game of Tic-tac-toe.\n
                    Winning condition: six in a row.
                `;
      }
    } else if (game.gameType === 'dot') {
      message_text = `
                Dot:\n
                ${user.username} invites you to join the endless game of Dot.\n
                Field size: ${game.dot_size}x${game.dot_size}
            `;
    } else {
      message_text = `
                Blot:
                ${user.username} invites you to join the endless game of Blot.
                Field size: ${game.blot_size}
            `;
    }

    const result = JSON.stringify({
      type: 'article',
      id: randomBytes(5).toString('hex'),
      title: `Invitation to the game!`,
      thumbnail_url:
        'https://ipfs.io/ipfs/bafkreidmkchryuy533s6vfcfsndjajnie2czaa64bp6sygz7zs4wksqbbq',
      thumbnail_width: 300,
      thumbnail_height: 300,
      input_message_content: {
        message_text,
      },
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'To the fight',
              url: `https://t.me/TacTicToe_bot?startapp=lobby_${user.current_game}__ref=${userId}`,
            },
          ],
        ],
      },
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

  @Get('getInvoiceLink')
  async getInvoiceLink(@Query('amount') amount: number) {
    const prices = [{ label: 'XTR', amount }];

    return this.createInvoiceLink({
      title: 'Buy stars',
      description: 'Buy stars',
      photo_url: 'https://cdn.notwise.co/energyRefill.jpg',
      payload: '',
      currency: 'XTR',
      prices,
    });
  }
}
