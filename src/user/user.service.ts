import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  async getUser(tgId: string) {
    const user = await this.prisma.user.findUnique({ where: { tgId } });

    return user;
  }
}
