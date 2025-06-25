import { Logger } from '@nestjs/common';
import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { SocketWithAuth } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from 'src/redis/redis.service';

@WebSocketGateway({ namespace: '/ws' })
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService
  ) { }

  private readonly logger = new Logger(GameGateway.name);

  handleConnection(client: SocketWithAuth) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: SocketWithAuth) {
    console.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('createGame')
  async handleCreateGame(
    @ConnectedSocket() client: SocketWithAuth,
    @MessageBody() data: { gameType: 'dot' | 'blot' | 'xo'; winLines?: number }
  ) {
    try {
      const { gameType, winLines } = data;

      if (!['dot', 'blot', 'xo'].includes(gameType)) {
        return client.emit('error', { message: 'Invalid gameType' });
      }

      if (gameType === 'xo' && (winLines !== 5 && winLines !== 6)) {
        return client.emit('error', { message: 'Invalid winLines for XO. Must be 5 or 6.' });
      }

      const newGame = await this.prisma.game.create({
        data: {
          gameType,
          winLines: gameType === 'xo' ? winLines : null,
          creatorId: client.tgId
        }
      });

      client.emit('gameCreated', newGame);
    } catch (err) {
      this.logger.error('Failed to create game', err);
      client.emit('error', { message: 'Failed to create game' });
    }
  }


  @SubscribeMessage('joinGame')
  async handleJoinGame(
    @ConnectedSocket() client: SocketWithAuth,
    @MessageBody() data: { gameId: string }
  ) {
    const { gameId } = data;

    try {
      const game = await this.prisma.game.findUnique({ where: { id: gameId } });

      if (!game) {
        return client.emit('error', { message: 'Game not found' });
      }

      if (game.status !== 'waiting') {
        return client.emit('error', { message: 'Game is not joinable' });
      }

      if (game.joinerId) {
        return client.emit('error', { message: 'Game already has a joiner' });
      }

      if (game.creatorId === client.tgId) {
        return client.emit('error', { message: 'You cannot join your own game' });
      }

      const updatedGame = await this.prisma.game.update(
        {
          where: { id: gameId },
          data: { joinerId: client.tgId, status: 'started', startedAt: new Date() }
        }
      );

      await this.redis.setKey(`game:${gameId}:board`, JSON.stringify([]));
      await this.redis.setKey(`game:${gameId}:turn`, game.creatorId);


      client.emit('gameJoined', updatedGame);
      this.server.to(game.creatorId).emit?.('opponentJoined', updatedGame);

    } catch (error) {
      this.logger.error('Failed to join game', error);
      client.emit('error', { message: 'Failed to join game' });
    }
  }


  @SubscribeMessage('makeMove')
  async handleMakeMove(
    @ConnectedSocket() client: SocketWithAuth,
    @MessageBody() data: { gameId: string; x: number; y: number }
  ) {
    const { gameId, x, y } = data;
    const playerId = client.tgId;

    const game = await this.prisma.game.findUnique({ where: { id: gameId } });
    if (!game || game.status !== 'started') return client.emit('error', { message: 'Invalid game' });

    const isPlayer = [game.creatorId, game.joinerId].includes(playerId);
    if (!isPlayer) return client.emit('error', { message: 'You are not a player' });

    const currentTurn = await this.redis.getKey(`game:${gameId}:turn`);
    if (currentTurn !== playerId) return client.emit('error', { message: 'Not your turn' });

    const rawMoves = await this.redis.getKey(`game:${gameId}:board`);
    const moves = rawMoves ? JSON.parse(rawMoves) : [];

    if (moves.some(m => m.x === x && m.y === y)) {
      return client.emit('error', { message: 'Cell is already taken' });
    }

    const newMove = { x, y, playerId };
    moves.push(newMove);

    await this.redis.setKey(`game:${gameId}:board`, JSON.stringify(moves));

    const won = this.checkWin(moves, playerId, game.winLines ?? 5);

    if (won) {
      await this.redis.deleteKey(`game:${gameId}:board`);
      await this.redis.deleteKey(`game:${gameId}:turn`)

      await this.prisma.game.update({
        where: { id: gameId },
        data: {
          status: 'finished',
          endedAt: new Date(),
          winReason: 'fair_win',
        }
      });

      this.server.to(game.creatorId).emit('gameEnded', { winner: playerId });
      this.server.to(game.joinerId!).emit('gameEnded', { winner: playerId });
      return;
    }

    const nextTurn = playerId === game.creatorId ? game.joinerId : game.creatorId;
    await this.redis.setKey(`game:${gameId}:turn`, nextTurn!);

    this.server.to(game.creatorId).emit('moveMade', newMove);
    this.server.to(game.joinerId!).emit('moveMade', newMove);
  }

  private checkWin(moves: { x: number; y: number; playerId: string }[], playerId: string, winLines: number) {
    const board = new Map<string, boolean>();
  
    for (const move of moves) {
      if (move.playerId === playerId) {
        board.set(`${move.x},${move.y}`, true);
      }
    }
  
    const directions = [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, -1] 
    ];
  
    for (const { x, y } of moves.filter(m => m.playerId === playerId)) {
      for (const [dx, dy] of directions) {
        let count = 1;
        for (let step = 1; step < winLines; step++) {
          if (board.has(`${x + dx * step},${y + dy * step}`)) {
            count++;
          } else break;
        }
        if (count >= winLines) return true;
      }
    }
  
    return false;
  }
  


}
