import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { RequestWithAuth, SocketWithAuth } from './auth.types';
import { parse, validate } from './auth.utils';
import { ExpiredError } from '../constants/auth.constants';
import { ConfigService } from '@nestjs/config';
import { WsUnauthorizedException } from '../exceptions/ws.exceptions';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request: RequestWithAuth = context.switchToHttp().getRequest();

    const initData = this.extractInitDataFromHeader(request);
    if (!initData) {
      throw new UnauthorizedException('No init data provided');
    }

    try {
      const botToken = this.configService.get<string>('BOT_TOKEN');
      validate(initData, botToken!, 86400);
    } catch (error) {
      if (error instanceof ExpiredError) {
        throw new BadRequestException('Init data expired');
      }
      throw new BadRequestException('Invalid init data');
    }

    const payload = parse(initData);
    request.tgId = payload.user.id;
    request.username = payload.user.firstName;
    request.photo_url = payload.user.photo_url;

    return true;
  }

  private extractInitDataFromHeader(request: RequestWithAuth): string | null {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    return authHeader.split(' ')[1];
  }
}

@Injectable()
export class WsAuthGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const client: SocketWithAuth = context.switchToWs().getClient();

    const initData = this.extractInitDataFromHeader(client);
    if (!initData) {
      throw new WsUnauthorizedException('No init data provided');
    }

    try {
      const botToken = this.configService.get<string>('BOT_TOKEN');
      validate(initData, botToken!, 86400);
    } catch (error) {
      if (error instanceof ExpiredError) {
        throw new BadRequestException('Init data expired');
      }
      throw new BadRequestException('Invalid init data');
    }

    const payload = parse(initData);
    client.tgId = payload.user.id;
    client.username = payload.user.firstName;
    client.photo_url = payload.user.photo_url;

    return true;
  }

  private extractInitDataFromHeader(client: SocketWithAuth): string | null {
    const authHeader = client.handshake.auth?.token;
    if (!authHeader) {
      return null;
    }
    return authHeader;
  }
}
