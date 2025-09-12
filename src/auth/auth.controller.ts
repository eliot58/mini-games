import { Controller, HttpCode, Post, Query, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { FastifyRequest } from 'fastify';
import { LoginDto } from './login.dto';

@Controller('auth')
export class AuthController {
    constructor(
        private readonly authService: AuthService
    ) { }

    @Post('login')
    @HttpCode(200)
    async login(@Query() data: LoginDto, @Req() req: FastifyRequest) {
        return await this.authService.login(data.initData, data.invited_by, req);
    }
}
