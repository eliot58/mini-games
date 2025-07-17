import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { RequestWithAuth, SocketWithAuth } from './auth.types';
import { isValid, parse } from '@telegram-apps/init-data-node';
import { ConfigService } from '@nestjs/config';
import { WsBadRequestException, WsUnauthorizedException } from '../exceptions/ws.exceptions';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request: RequestWithAuth = context.switchToHttp().getRequest();

    const initData = this.extractInitDataFromHeader(request);
    if (!initData) {
      throw new UnauthorizedException('No init data provided');
    }

    const botToken = this.configService.get<string>('BOT_TOKEN');

    if (!isValid(initData, botToken!)) {
      throw new BadRequestException('Invalid init data');
    }

    const parsed = parse(initData);

    if (!parsed.user) return false;
    request.tgId = parsed.user.id.toString();
    request.username = parsed.user.first_name;
    request.photo_url = parsed.user.photo_url || '';

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

    // const botToken = this.configService.get<string>('BOT_TOKEN');

    // if (!isValid(initData, botToken!)) {
    //   throw new WsBadRequestException('Invalid init data');
    // }

    // const parsed = parse(initData);

    // if (!parsed.user) return false;
    client.tgId = initData
    client.username = "tester"
    client.photo_url = 'https://t.me/i/userpic/320/uoiJifv6U_eKqgm9fOtGAycK4pcVPTYLqap2sq4UkK4.svg';

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
