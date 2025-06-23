import { Logger } from '@nestjs/common';
import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { SocketWithAuth } from '../auth/auth.types';
import { GameService } from './game.service';

@WebSocketGateway({ namespace: '/ws' })
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  constructor(private readonly gameService: GameService) {}

  private readonly logger = new Logger(GameGateway.name);

  handleConnection(client: SocketWithAuth) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: SocketWithAuth) {
    console.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('createGame')
  async handleCreateGame(@ConnectedSocket() client: SocketWithAuth) {
    const game = await this.gameService.createGame();
    client.join(game.id);
    return { event: 'gameCreated', data: game };
  }

  @SubscribeMessage('joinGame')
  async handleJoinGame(
    @MessageBody() data: { gameId: string },
    @ConnectedSocket() client: SocketWithAuth,
  ) {
    const game = await this.gameService.joinGame(data.gameId);
    if (!game) {
      return { event: 'error', message: 'Cannot join game' };
    }
    client.join(game.id);
    this.server.to(game.id).emit('gameJoined', game);
    return { event: 'joinedGame', data: game };
  }

  @SubscribeMessage('makeMove')
  async handleMakeMove(
    @MessageBody() data: { gameId: string; move: { player: 'cross' | 'circle'; position: { x: number; y: number } } },
  ) {
    const game = await this.gameService.makeMove(data.gameId, data.move);
    if (!game) {
      return { event: 'error', message: 'Invalid move' };
    }

    this.server.to(data.gameId).emit('gameUpdated', game);
    return { event: 'moveMade', data: game };
  }
}
