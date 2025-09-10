import { Controller, HttpCode, Post, Query, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { FastifyRequest } from 'fastify';

@Controller('auth')
export class AuthController {
    constructor(
        private readonly authService: AuthService
    ) { }

    @Post('login')
    @HttpCode(200)
    async login(@Query('initData') initData: string, @Req() req: FastifyRequest) {
        return await this.authService.login(initData, req);
    }
}
