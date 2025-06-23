import { Controller, Get, Req } from '@nestjs/common';
import { UserService } from './user.service';
import { RequestWithAuth } from 'src/auth/auth.types';

@Controller('user')
export class UserController {
    constructor(private readonly userService: UserService) { }

    @Get()
    async getUser(@Req() req: RequestWithAuth) {
        return this.userService.getUser(req);
    }
}
