import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class GameService {
    private readonly WINLINE = 5;

    constructor(private readonly prisma: PrismaService) { }

    async createGame() {
        return await this.prisma.game.create({
            data: {
                status: 'waiting',
                currentPlayer: 'cross',
                squares: {
                    create: {
                        x: 0,
                        y: 0,
                    },
                },
            },
            include: { squares: true },
        });
    }

    async joinGame(gameId: string) {
        const game = await this.prisma.game.findUnique({
            where: { id: gameId },
            include: { squares: true },
        });

        if (!game || game.status !== 'waiting') return null;

        return await this.prisma.game.update({
            where: { id: gameId },
            data: { status: 'started' },
            include: { squares: true },
        });
    }

    async makeMove(gameId: string, move: { player: 'cross' | 'circle'; position: { x: number; y: number } }) {
        const game = await this.prisma.game.findUnique({
            where: { id: gameId },
            include: { squares: true },
        });

        if (!game || game.currentPlayer !== move.player || game.status !== 'started') {
            return null;
        }

        const existing = game.squares.find(
            (s) => s.x === move.position.x && s.y === move.position.y
        );

        if (existing && existing.figure) return null;

        if (existing) {
            await this.prisma.square.update({
                where: { id: existing.id },
                data: { figure: move.player },
            });
        } else {
            await this.prisma.square.create({
                data: {
                    x: move.position.x,
                    y: move.position.y,
                    figure: move.player,
                    gameId,
                },
            });
        }

        const updatedSquares = await this.prisma.square.findMany({
            where: { gameId },
        });

        const winLine = this.checkWinLine(updatedSquares, move.position, move.player);

        if (winLine) {
            await this.prisma.game.update({
                where: { id: gameId },
                data: {
                    winLineStart: { x: winLine.start.x, y: winLine.start.y },
                    winLineEnd: { x: winLine.end.x, y: winLine.end.y },
                    winDirection: winLine.direction,
                    status: 'finished',
                },
            });
        } else {
            await this.prisma.game.update({
                where: { id: gameId },
                data: {
                    currentPlayer: move.player === 'cross' ? 'circle' : 'cross',
                },
            });
            await this.addNewSquaresAround(gameId, move.position, updatedSquares);
        }

        return this.prisma.game.findUnique({
            where: { id: gameId },
            include: { squares: true },
        });
    }

    private checkWinLine(
        squares: { x: number; y: number; figure: string | null }[],
        lastMove: { x: number; y: number },
        player: 'cross' | 'circle'
    ): { start: { x: number; y: number }; end: { x: number; y: number }; direction: 'horizontal' | 'vertical' | 'diagonal' | 'antiDiagonal' } | null {
        const directions: { dx: number; dy: number; type: 'horizontal' | 'vertical' | 'diagonal' | 'antiDiagonal' }[] = [
            { dx: 1, dy: 0, type: 'horizontal' },
            { dx: 0, dy: 1, type: 'vertical' },
            { dx: 1, dy: 1, type: 'diagonal' },
            { dx: 1, dy: -1, type: 'antiDiagonal' },
        ];


        for (const dir of directions) {
            let count = 1;
            let start = { ...lastMove };
            let end = { ...lastMove };

            for (let i = 1; i < this.WINLINE; i++) {
                const pos = { x: lastMove.x + dir.dx * i, y: lastMove.y + dir.dy * i };
                const square = squares.find(s => s.x === pos.x && s.y === pos.y && s.figure === player);
                if (square) {
                    count++;
                    end = pos;
                } else break;
            }

            for (let i = 1; i < this.WINLINE; i++) {
                const pos = { x: lastMove.x - dir.dx * i, y: lastMove.y - dir.dy * i };
                const square = squares.find(s => s.x === pos.x && s.y === pos.y && s.figure === player);
                if (square) {
                    count++;
                    start = pos;
                } else break;
            }

            if (count >= this.WINLINE) {
                return { start, end, direction: dir.type };
            }
        }

        return null;
    }

    private async addNewSquaresAround(gameId: string, center: { x: number; y: number }, squares: { x: number; y: number }[]) {
        const newSquares: { x: number; y: number }[] = [];

        for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
                if (dx === 0 && dy === 0) continue;

                const x = center.x + dx;
                const y = center.y + dy;

                if (!squares.find(s => s.x === x && s.y === y)) {
                    newSquares.push({ x, y });
                }
            }
        }

        await this.prisma.square.createMany({
            data: newSquares.map(pos => ({ ...pos, gameId })),
            skipDuplicates: true,
        });
    }
}
