import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { RequestWithAuth, SocketWithAuth } from './auth.types';
import { WsUnauthorizedException } from '../exceptions/ws.exceptions';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: RequestWithAuth = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    if (!token) throw new UnauthorizedException('No token provided');

    try {
      const payload = await this.jwtService.verifyAsync(token);

      if (payload.type !== "access") throw new UnauthorizedException('Invalid token type');


      request.tgId = payload.sub;
    } catch (err) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    return true;
  }

  private extractTokenFromHeader(request: RequestWithAuth): string | null {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    return authHeader.split(' ')[1];
  }
}

@Injectable()
export class WsAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client: SocketWithAuth = context.switchToWs().getClient();

    const token = this.extractInitDataFromHeader(client);
    if (!token) {
      throw new WsUnauthorizedException('No token provided');
    }

    try {
      const payload = await this.jwtService.verifyAsync(token);

      if (payload.type !== "access") throw new WsUnauthorizedException('Invalid token type');


      client.tgId = payload.sub;
    } catch (err) {
      throw new WsUnauthorizedException('Invalid or expired token');
    }

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
