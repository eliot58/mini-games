import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RequestWithAuth } from '../auth/auth.types';

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  async getUser(req: RequestWithAuth) {
    let user = await this.prisma.user.findUnique({ where: { tgId: req.tgId } });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          tgId: req.tgId,
          username: req.username,
          photo_url: req.photo_url,
        },
      });
    }

    return user;
  }
}
