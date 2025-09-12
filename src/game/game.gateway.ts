import { Logger, UseGuards } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { SocketWithAuth } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { WsAuthGuard } from '../auth/auth.guard';

@WebSocketGateway({ namespace: '/ws', cors: { origin: '*' } })
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) { }

  private readonly logger = new Logger(GameGateway.name);

  handleConnection(client: SocketWithAuth) {
    this.logger.log(`Client connected: tgId=${client.tgId}`);
  }

  async handleDisconnect(client: SocketWithAuth) {
    this.logger.log(`Client disconnected: tgId=${client.tgId}`);

    const user = await this.prisma.user.findUnique({
      where: { tgId: client.tgId },
    });

    if (!user) {
      this.logger.warn(`User not found on disconnect: tgId=${client.tgId}`);
      return client.emit('error', { message: 'User not found' });
    }

    if (user.current_game) {
      const game = await this.prisma.game.findUnique({
        where: { id: user.current_game },
      });

      if (!game) {
        this.logger.warn(`Game not found on disconnect: gameId=${user.current_game}`);
        return client.emit('error', { message: 'Game not found' });
      }

      if (game.status === 'started') {
        const opponentId =
          game.creatorId === user.tgId ? game.joinerId : game.creatorId;

          const opponentSocketId =
          game.creatorId === user.tgId ? game.joinerSocketId : game.creatorSocketId;

        await this.prisma.game.update({
          where: { id: game.id },
          data: {
            status: 'finished',
            endedAt: new Date(),
            winReason: 'opponent_left',
            winnerId: opponentId!,
          },
        });

        await this.prisma.user.updateMany({
          where: {
            tgId: { in: [game.creatorId, game.joinerId!].filter(Boolean) },
          },
          data: { current_game: null },
        });

        this.logger.log(`Game ended due to disconnect: gameId=${game.id}, winner=${opponentId}`);

        this.server
          .to(opponentSocketId!)
          .emit('opponentLeft', { gameId: game.id, winner: opponentId });
      }
    }
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage('createGame')
  async handleCreateGame(
    @ConnectedSocket() client: SocketWithAuth,
    @MessageBody()
    data: {
      gameType: 'dot' | 'blot' | 'xo';
      winLines?: number;
      dot_size?: number;
      blot_size?: 'small' | 'medium' | 'big';
    },
  ) {
    this.logger.log(`createGame requested: tgId=${client.tgId}, data=${JSON.stringify(data)}`);

    try {
      const user = await this.prisma.user.findUnique({
        where: { tgId: client.tgId },
      });

      if (!user) {
        this.logger.warn(`User not found: tgId=${client.tgId}`);
        return client.emit('error', { message: 'User not found' });
      }

      if (user.current_game) {
        this.logger.warn(`User is already in a game: tgId=${client.tgId}, gameId=${user.current_game}`);
        return client.emit('error', { message: 'You are already in a game' });
      }      

      if (user.balance < 10) {
        this.logger.warn(`Not enough balance: tgId=${client.tgId}, balance=${user.balance}`);
        return client.emit('error', { message: 'Not enough balance' });
      }

      const { gameType, winLines, dot_size, blot_size } = data;

      if (!['dot', 'blot', 'xo'].includes(gameType)) {
        this.logger.warn(`Invalid gameType: ${gameType}`);
        return client.emit('error', { message: 'Invalid gameType' });
      }

      if (gameType === 'xo' && (winLines !== 5 && winLines !== 6)) {
        return client.emit('error', { message: 'Invalid winLines for XO. Must be 5 or 6.' });
      }

      if (gameType === 'dot' && (!dot_size || dot_size < 100 || dot_size > 200)) {
        return client.emit('error', {
          message: 'Invalid dot_size for dot. Must be between 100 and 200.',
        });
      }

      if (gameType === 'blot') {
        const allowedSizes = ['small', 'medium', 'big'];
        if (!blot_size || !allowedSizes.includes(blot_size)) {
          return client.emit('error', {
            message: 'Invalid blot_size for blot. Must be small, medium, or big.',
          });
        }
      }

      const newGame = await this.prisma.game.create({
        data: {
          gameType,
          winLines: gameType === 'xo' ? winLines : null,
          dot_size: gameType === 'dot' ? dot_size : null,
          blot_size: gameType === 'blot' ? blot_size : null,
          creatorId: client.tgId,
          creatorSocketId: client.id
        },
      });

      await this.prisma.user.update({
        where: { tgId: client.tgId },
        data: { current_game: newGame.id },
      });

      this.logger.log(`Game created: gameId=${newGame.id}, creatorId=${client.tgId}`);
      client.emit('gameCreated', newGame);
    } catch (err) {
      this.logger.error('Failed to create game', err);
      client.emit('error', { message: 'Failed to create game' });
    }
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage('joinGame')
  async handleJoinGame(
    @ConnectedSocket() client: SocketWithAuth,
    @MessageBody() data: { gameId: string },
  ) {
    const { gameId } = data;
    this.logger.log(`joinGame requested: tgId=${client.tgId}, gameId=${gameId}`);

    try {
      const game = await this.prisma.game.findUnique({ where: { id: gameId } });

      if (!game) {
        this.logger.warn(`Game not found: gameId=${gameId}`);
        return client.emit('error', { message: 'Game not found' });
      }

      if (game.status !== 'waiting') {
        this.logger.warn(`Game is not joinable: gameId=${gameId}, status=${game.status}`);
        return client.emit('error', { message: 'Game is not joinable' });
      }

      if (game.joinerId) {
        this.logger.warn(`Game already has a joiner: gameId=${gameId}`);
        return client.emit('error', { message: 'Game already has a joiner' });
      }

      if (game.creatorId === client.tgId) {
        return client.emit('error', { message: 'You cannot join your own game' });
      }

      const updatedGame = await this.prisma.game.update({
        where: { id: gameId },
        data: {
          joinerId: client.tgId,
          joinerSocketId: client.id,
          status: 'started',
          startedAt: new Date()
        },
      });

      await this.redis.setKey(`game:${gameId}:board`, JSON.stringify([]));
      await this.redis.setKey(`game:${gameId}:turn`, game.creatorId);

      await this.prisma.user.update({
        where: { tgId: game.creatorId },
        data: { balance: { decrement: 10 } },
      });

      this.logger.log(`Game started: gameId=${gameId}, joinerId=${client.tgId}`);
      client.emit('gameJoined', updatedGame);
      this.server.to(game.creatorSocketId).emit('opponentJoined', updatedGame);
    } catch (error) {
      this.logger.error('Failed to join game', error);
      client.emit('error', { message: 'Failed to join game' });
    }
  }

  @UseGuards(WsAuthGuard)
  @SubscribeMessage('makeMove')
  async handleMakeMove(
    @ConnectedSocket() client: SocketWithAuth,
    @MessageBody() data: { gameId: string; x: number; y: number },
  ) {
    const { gameId, x, y } = data;
    const playerId = client.tgId;

    this.logger.log(`makeMove: gameId=${gameId}, playerId=${playerId}, x=${x}, y=${y}`);

    const game = await this.prisma.game.findUnique({ where: { id: gameId } });
    if (!game || game.status !== 'started') {
      return client.emit('error', { message: 'Invalid game' });
    }

    const isPlayer = [game.creatorId, game.joinerId].includes(playerId);
    if (!isPlayer) {
      return client.emit('error', { message: 'You are not a player' });
    }

    const currentTurn = await this.redis.getKey(`game:${gameId}:turn`);
    if (currentTurn !== playerId) {
      return client.emit('error', { message: 'Not your turn' });
    }

    const rawMoves = await this.redis.getKey(`game:${gameId}:board`);
    const moves = rawMoves ? JSON.parse(rawMoves) : [];

    if (moves.some((m) => m.x === x && m.y === y)) {
      return client.emit('error', { message: 'Cell is already taken' });
    }

    const newMove = { x, y, playerId };
    moves.push(newMove);
    await this.redis.setKey(`game:${gameId}:board`, JSON.stringify(moves));

    const won = this.checkWin(moves, playerId, game.winLines ?? 5);

    if (won) {
      await this.redis.deleteKey(`game:${gameId}:board`);
      await this.redis.deleteKey(`game:${gameId}:turn`);

      await this.prisma.game.update({
        where: { id: gameId },
        data: {
          status: 'finished',
          endedAt: new Date(),
          winReason: 'fair_win',
          winnerId: playerId,
        },
      });

      await this.prisma.user.updateMany({
        where: { tgId: { in: [game.creatorId, game.joinerId!] } },
        data: { current_game: null },
      });

      this.logger.log(`Game won: gameId=${gameId}, winnerId=${playerId}`);
      this.server.to(game.creatorSocketId).emit('gameEnded', { winner: playerId });
      this.server.to(game.joinerSocketId!).emit('gameEnded', { winner: playerId });
      return;
    }

    const nextTurn = playerId === game.creatorId ? game.joinerId : game.creatorId;
    await this.redis.setKey(`game:${gameId}:turn`, nextTurn!);

    this.logger.log(`Move made: gameId=${gameId}, playerId=${playerId}, nextTurn=${nextTurn}`);
    this.server.to(game.creatorSocketId).emit('moveMade', newMove);
    this.server.to(game.joinerSocketId!).emit('moveMade', newMove);
  }

  private checkWin(
    moves: { x: number; y: number; playerId: string }[],
    playerId: string,
    winLines: number,
  ) {
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
      [1, -1],
    ];

    for (const { x, y } of moves.filter((m) => m.playerId === playerId)) {
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
