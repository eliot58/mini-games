import { Logger, UseGuards } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { SocketWithAuth } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { WsAuthGuard } from '../auth/auth.guard';

type GameLite = {
  id: string;
  creatorId: string;
  joinerId: string | null;
  creatorSocketId: string;
  joinerSocketId: string | null;
};

@WebSocketGateway({ namespace: '/ws', cors: { origin: '*' } })
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
  @WebSocketServer() server: Server;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) { }

  private readonly logger = new Logger(GameGateway.name);

  // ====== TIME CONTROL SETTINGS ======
  // Общее время на игрока в мс (измени при необходимости)
  private static readonly TIME_CONTROL_MS = 180_000; // 60s per player
  // Периодическая рассылка timeSync всем активным играм
  private static readonly TIMESYNC_INTERVAL_MS = 2_000;

  // ====== REDIS KEYS ======
  private rk = {
    turn: (g: string) => `game:${g}:turn`,        // tgId игрока, чей ход
    board: (g: string) => `game:${g}:board`,      // массив ходов
    lastTick: (g: string) => `game:${g}:lastTick`,// timestamp ms начала текущего хода
    cLeft: (g: string) => `game:${g}:creatorLeft`,
    jLeft: (g: string) => `game:${g}:joinerLeft`,
  };

  // ====== GATEWAY LIFECYCLE ======
  afterInit() {
    setInterval(() => this.broadcastTimeSync().catch(err => this.logger.error('broadcastTimeSync error', err)), GameGateway.TIMESYNC_INTERVAL_MS);
  }

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

      if (game.status === 'waiting') {
        await this.prisma.$transaction(async (tx) => {

          await tx.game.deleteMany({
            where: { id: game.id, status: 'waiting', creatorId: client.tgId },
          });

          await tx.user.updateMany({
            where: { current_game: game.id },
            data: { current_game: null },
          });
        })
      }

      if (game.status === 'started') {
        const opponentId = game.creatorId === user.tgId ? game.joinerId : game.creatorId;
        const opponentSocketId = game.creatorId === user.tgId ? game.joinerSocketId : game.creatorSocketId;

        const upd = await this.updateAndCheckTimeout({
          id: game.id,
          creatorId: game.creatorId,
          joinerId: game.joinerId,
          creatorSocketId: game.creatorSocketId,
          joinerSocketId: game.joinerSocketId,
        });

        const cLeft = upd.creatorLeft ?? GameGateway.TIME_CONTROL_MS;
        const jLeft = upd.joinerLeft ?? GameGateway.TIME_CONTROL_MS;

        await this.finishGameWithTimes({
          gameId: game.id,
          winnerId: opponentId!,
          winReason: 'opponent_left',
          creatorLeftMs: cLeft,
          joinerLeftMs: jLeft,
          creatorSocketId: game.creatorSocketId,
          joinerSocketId: game.joinerSocketId ?? undefined,
        });

        await this.prisma.user.updateMany({
          where: { tgId: { in: [game.creatorId, game.joinerId!].filter(Boolean) as string[] } },
          data: { current_game: null },
        });

        this.logger.log(`Game ended due to disconnect: gameId=${game.id}, winner=${opponentId}`);
        if (opponentSocketId) {
          this.server.to(opponentSocketId).emit('opponentLeft', { gameId: game.id, winner: opponentId });
        }
      }
    }
  }

  // ====== PUBLIC MESSAGES ======

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
          creatorSocketId: client.id,
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
  @SubscribeMessage('dissolveGame')
  async handleDissolveGameAlias(
    @ConnectedSocket() client: SocketWithAuth
  ) {
    try {
      const user = await this.prisma.user.findUnique({ where: { tgId: client.tgId } });
      if (!user) {
        this.logger.warn(`User not found on dissolve: tgId=${client.tgId}`);
        return client.emit('error', { message: 'User not found' });
      }

      if (!user.current_game) {
        return client.emit('error', { message: 'You are not in a game' });
      }

      const game = await this.prisma.game.findUnique({ where: { id: user.current_game } });
      if (!game) {
        this.logger.warn(`Game not found on dissolve: gameId=${user.current_game}`);
        return client.emit('error', { message: 'Game not found' });
      }

      if (game.status !== 'waiting') {
        return client.emit('error', { message: 'Game is not in waiting status' });
      }

      if (game.creatorId !== client.tgId) {
        return client.emit('error', { message: 'Only creator can dissolve the game' });
      }

      const res = await this.prisma.$transaction(async (tx) => {
        const del = await tx.game.deleteMany({
          where: { id: game.id, status: 'waiting', creatorId: client.tgId },
        });

        if (del.count === 0) {
          return { deleted: false };
        }

        await tx.user.updateMany({
          where: { current_game: game.id },
          data: { current_game: null },
        });

        return { deleted: true };
      });

      if (!res.deleted) {
        return client.emit('error', { message: 'Game already started or was dissolved' });
      }

      this.logger.log(`Game dissolved by creator: gameId=${game.id}, creator=${client.tgId}`);
      client.emit('gameDissolved', { gameId: game.id });
    } catch (e) {
      this.logger.error('Failed to dissolve waiting game', e as any);
      client.emit('error', { message: 'Failed to dissolve game' });
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
          startedAt: new Date(),
        },
      });

      // ИНИЦИАЛИЗАЦИЯ игрового состояния в Redis
      const now = Date.now();
      await this.redis.setKey(this.rk.board(gameId), JSON.stringify([]));
      await this.redis.setKey(this.rk.turn(gameId), updatedGame.creatorId);

      // Таймеры
      await this.setTimeState(gameId, {
        turn: updatedGame.creatorId,
        lastTick: now,
        creatorLeft: GameGateway.TIME_CONTROL_MS,
        joinerLeft: GameGateway.TIME_CONTROL_MS,
      });

      // списываем 10 очков у создателя
      await this.prisma.user.update({
        where: { tgId: updatedGame.creatorId },
        data: { balance: { decrement: 10 } },
      });

      this.logger.log(`Game started: gameId=${gameId}, joinerId=${client.tgId}`);

      // нотификации
      client.emit('gameJoined', updatedGame);
      this.server.to(updatedGame.creatorSocketId).emit('opponentJoined', updatedGame);

      // отправим первый timeSync
      await this.emitTimeSync(
        gameId,
        { creator: updatedGame.creatorSocketId, joiner: updatedGame.joinerSocketId ?? undefined },
        { creatorMs: GameGateway.TIME_CONTROL_MS, joinerMs: GameGateway.TIME_CONTROL_MS },
      );
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

    const currentTurn = await this.redis.getKey(this.rk.turn(gameId));
    if (currentTurn !== playerId) {
      return client.emit('error', { message: 'Not your turn' });
    }

    const upd = await this.updateAndCheckTimeout({
      id: game.id,
      creatorId: game.creatorId,
      joinerId: game.joinerId,
      creatorSocketId: game.creatorSocketId,
      joinerSocketId: game.joinerSocketId,
    });
    if (upd.timeout) {
      const winnerId = upd.loserId === game.creatorId ? game.joinerId! : game.creatorId;

      await this.finishGameWithTimes({
        gameId,
        winnerId,
        winReason: 'timeout',
        creatorLeftMs: upd.creatorLeft ?? 0,
        joinerLeftMs: upd.joinerLeft ?? 0,
        creatorSocketId: game.creatorSocketId,
        joinerSocketId: game.joinerSocketId ?? undefined,
      });

      await this.prisma.user.updateMany({
        where: { tgId: { in: [game.creatorId, game.joinerId!].filter(Boolean) as string[] } },
        data: { current_game: null },
      });

      this.logger.log(`Game timeout: gameId=${gameId}, winner=${winnerId}`);
      return;
    }

    // 2) обычная логика хода
    const rawMoves = await this.redis.getKey(this.rk.board(gameId));
    const moves = rawMoves ? JSON.parse(rawMoves) : [];

    if (moves.some((m: any) => m.x === x && m.y === y)) {
      return client.emit('error', { message: 'Cell is already taken' });
    }

    const newMove = { x, y, playerId };
    moves.push(newMove);
    await this.redis.setKey(this.rk.board(gameId), JSON.stringify(moves));

    const won = this.checkWin(moves, playerId, game.winLines ?? 5);

    if (won) {
      const upd2 = await this.updateAndCheckTimeout({
        id: game.id,
        creatorId: game.creatorId,
        joinerId: game.joinerId,
        creatorSocketId: game.creatorSocketId,
        joinerSocketId: game.joinerSocketId,
      });

      await this.prisma.game.update({
        where: { id: gameId },
        data: {
          status: 'finished',
          endedAt: new Date(),
          winReason: 'fair_win',
          winnerId: playerId,
          moves: { increment: 1 },
          creatorTimeLeftMs: upd2.creatorLeft ?? null,
          joinerTimeLeftMs: upd2.joinerLeft ?? null,
        },
      });

      await this.prisma.user.updateMany({
        where: { tgId: { in: [game.creatorId, game.joinerId!].filter(Boolean) as string[] } },
        data: { current_game: null },
      });

      await this.clearTimeState(gameId);

      this.logger.log(`Game won: gameId=${gameId}, winnerId=${playerId}`);
      this.server.to(game.creatorSocketId).emit('gameEnded', { winner: playerId, reason: 'fair_win' });
      if (game.joinerSocketId) this.server.to(game.joinerSocketId).emit('gameEnded', { winner: playerId, reason: 'fair_win' });
      return;
    }

    // 3) переключаем ход, фиксируем lastTick = now
    const nextTurn = playerId === game.creatorId ? game.joinerId : game.creatorId;
    await this.redis.setKey(this.rk.turn(gameId), nextTurn!);
    await this.redis.setKey(this.rk.lastTick(gameId), String(Date.now()));

    await this.prisma.game.update({
      where: { id: gameId },
      data: { moves: { increment: 1 } },
    });

    // отправим обновлённые остатки времени после хода
    const st = await this.getTimeState(gameId);
    await this.emitTimeSync(gameId, { creator: game.creatorSocketId, joiner: game.joinerSocketId ?? undefined }, {
      creatorMs: st.creatorLeft ?? GameGateway.TIME_CONTROL_MS,
      joinerMs: st.joinerLeft ?? GameGateway.TIME_CONTROL_MS,
    });

    this.logger.log(`Move made: gameId=${gameId}, playerId=${playerId}, nextTurn=${nextTurn}`);
    this.server.to(game.creatorSocketId).emit('moveMade', newMove);
    if (game.joinerSocketId) this.server.to(game.joinerSocketId).emit('moveMade', newMove);
  }

  // Опционально: ручной тик от клиента для принудительной проверки
  @UseGuards(WsAuthGuard)
  @SubscribeMessage('tick')
  async handleTick(@ConnectedSocket() client: SocketWithAuth, @MessageBody() data: { gameId: string }) {
    const game = await this.prisma.game.findUnique({ where: { id: data.gameId } });
    if (!game || game.status !== 'started') return;

    const upd = await this.updateAndCheckTimeout({
      id: game.id,
      creatorId: game.creatorId,
      joinerId: game.joinerId,
      creatorSocketId: game.creatorSocketId,
      joinerSocketId: game.joinerSocketId,
    });

    if (upd.timeout) {
      const winnerId = upd.loserId === game.creatorId ? game.joinerId! : game.creatorId;
      await this.finishGameWithTimes({
        gameId: game.id,
        winnerId,
        winReason: 'timeout',
        creatorLeftMs: upd.creatorLeft ?? 0,
        joinerLeftMs: upd.joinerLeft ?? 0,
        creatorSocketId: game.creatorSocketId,
        joinerSocketId: game.joinerSocketId ?? undefined,
      });
      await this.prisma.user.updateMany({
        where: { tgId: { in: [game.creatorId, game.joinerId!].filter(Boolean) as string[] } },
        data: { current_game: null },
      });
    } else {
      await this.emitTimeSync(
        game.id,
        { creator: game.creatorSocketId, joiner: game.joinerSocketId ?? undefined },
        { creatorMs: upd.creatorLeft ?? 0, joinerMs: upd.joinerLeft ?? 0 },
      );
    }
  }

  // ====== TIMER BROADCAST LOOP ======
  private async broadcastTimeSync() {
    const activeGames = await this.prisma.game.findMany({
      where: { status: 'started' },
      select: { id: true, creatorId: true, joinerId: true, creatorSocketId: true, joinerSocketId: true },
    });

    for (const g of activeGames as GameLite[]) {
      const upd = await this.updateAndCheckTimeout(g);
      if (!upd) continue;

      if (upd.timeout) {
        const winnerId = upd.loserId === g.creatorId ? g.joinerId! : g.creatorId;
        await this.finishGameWithTimes({
          gameId: g.id,
          winnerId,
          winReason: 'timeout',
          creatorLeftMs: upd.creatorLeft ?? 0,
          joinerLeftMs: upd.joinerLeft ?? 0,
          creatorSocketId: g.creatorSocketId,
          joinerSocketId: g.joinerSocketId ?? undefined,
        });

        await this.prisma.user.updateMany({
          where: { tgId: { in: [g.creatorId, g.joinerId!].filter(Boolean) as string[] } },
          data: { current_game: null },
        });
      } else {
        await this.emitTimeSync(
          g.id,
          { creator: g.creatorSocketId, joiner: g.joinerSocketId ?? undefined },
          { creatorMs: upd.creatorLeft ?? 0, joinerMs: upd.joinerLeft ?? 0 },
        );
      }
    }
  }

  // ====== TIMER HELPERS ======
  private async getTimeState(gameId: string) {
    const [turn, lastTickStr, cStr, jStr] = await Promise.all([
      this.redis.getKey(this.rk.turn(gameId)),
      this.redis.getKey(this.rk.lastTick(gameId)),
      this.redis.getKey(this.rk.cLeft(gameId)),
      this.redis.getKey(this.rk.jLeft(gameId)),
    ]);

    return {
      turn: turn ?? null,
      lastTick: lastTickStr ? Number(lastTickStr) : null,
      creatorLeft: cStr ? Number(cStr) : null,
      joinerLeft: jStr ? Number(jStr) : null,
    };
  }

  private async setTimeState(
    gameId: string,
    data: {
      turn?: string;
      lastTick?: number;
      creatorLeft?: number;
      joinerLeft?: number;
    },
  ) {
    const ops: Promise<any>[] = [];
    if (data.turn !== undefined) ops.push(this.redis.setKey(this.rk.turn(gameId), data.turn));
    if (data.lastTick !== undefined) ops.push(this.redis.setKey(this.rk.lastTick(gameId), String(data.lastTick)));
    if (data.creatorLeft !== undefined) ops.push(this.redis.setKey(this.rk.cLeft(gameId), String(data.creatorLeft)));
    if (data.joinerLeft !== undefined) ops.push(this.redis.setKey(this.rk.jLeft(gameId), String(data.joinerLeft)));
    await Promise.all(ops);
  }

  private async clearTimeState(gameId: string) {
    await Promise.all([
      this.redis.deleteKey(this.rk.board(gameId)),
      this.redis.deleteKey(this.rk.turn(gameId)),
      this.redis.deleteKey(this.rk.lastTick(gameId)),
      this.redis.deleteKey(this.rk.cLeft(gameId)),
      this.redis.deleteKey(this.rk.jLeft(gameId)),
    ]);
  }

  /**
   * Списывает время у активного игрока на основании lastTick.
   * Возвращает актуальные остатки и факт тайм-аута.
   */
  private async updateAndCheckTimeout(game: GameLite | { id: string; creatorId: string; joinerId: string | null }) {
    const gameId = game.id;
    const now = Date.now();

    const { turn, lastTick, creatorLeft, joinerLeft } = await this.getTimeState(gameId);
    if (!turn || !lastTick || creatorLeft == null || joinerLeft == null) {
      return { creatorLeft, joinerLeft, timeout: false as const, loserId: null as string | null };
    }

    const elapsed = Math.max(0, now - lastTick);

    let cLeft = creatorLeft;
    let jLeft = joinerLeft;

    if (turn === (game as any).creatorId) cLeft = Math.max(0, creatorLeft - elapsed);
    else if (turn === (game as any).joinerId) jLeft = Math.max(0, joinerLeft - elapsed);

    // зафиксируем списание и обновим lastTick, чтобы дальше считать от "сейчас"
    await this.setTimeState(gameId, { creatorLeft: cLeft, joinerLeft: jLeft, lastTick: now });

    if (cLeft === 0 || jLeft === 0) {
      const loserId = cLeft === 0 ? (game as any).creatorId : (game as any).joinerId!;
      return { creatorLeft: cLeft, joinerLeft: jLeft, timeout: true as const, loserId };
    }

    return { creatorLeft: cLeft, joinerLeft: jLeft, timeout: false as const, loserId: null as string | null };
  }

  /** Завершение игры с записью остатков времени в БД и очисткой Redis */
  private async finishGameWithTimes(params: {
    gameId: string;
    winnerId: string;
    winReason: 'timeout' | 'opponent_left' | 'fair_win';
    creatorLeftMs: number;
    joinerLeftMs: number;
    creatorSocketId?: string;
    joinerSocketId?: string;
  }) {
    const { gameId, winnerId, winReason, creatorLeftMs, joinerLeftMs, creatorSocketId, joinerSocketId } = params;

    await this.prisma.game.update({
      where: { id: gameId },
      data: {
        status: 'finished',
        endedAt: new Date(),
        winReason,
        winnerId,
        creatorTimeLeftMs: creatorLeftMs,
        joinerTimeLeftMs: joinerLeftMs,
      },
    });

    await this.clearTimeState(gameId);

    const payload = {
      winner: winnerId,
      reason: winReason,
      creatorTimeLeftMs: creatorLeftMs,
      joinerTimeLeftMs: joinerLeftMs,
    };

    if (creatorSocketId) this.server.to(creatorSocketId).emit('gameEnded', payload);
    if (joinerSocketId) this.server.to(joinerSocketId).emit('gameEnded', payload);
  }

  /** Синхронизация времени клиентам (включая turn и serverTs) */
  private async emitTimeSync(
    gameId: string,
    sockets: { creator?: string; joiner?: string },
    left: { creatorMs: number; joinerMs: number },
  ) {
    const { turn } = await this.getTimeState(gameId);
    const payload = {
      gameId,
      creatorTimeLeftMs: left.creatorMs,
      joinerTimeLeftMs: left.joinerMs,
      turn,
      serverTs: Date.now(),
    };
    if (sockets.creator) this.server.to(sockets.creator).emit('timeSync', payload);
    if (sockets.joiner) this.server.to(sockets.joiner).emit('timeSync', payload);
  }

  // ====== WIN CHECK ======
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
