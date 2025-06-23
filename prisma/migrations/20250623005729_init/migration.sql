-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('waiting', 'started', 'finished');

-- CreateTable
CREATE TABLE "users" (
    "tgId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "totalGames" INTEGER NOT NULL DEFAULT 0,
    "totalWins" INTEGER NOT NULL DEFAULT 0,
    "username" TEXT NOT NULL,
    "photo_url" TEXT NOT NULL,
    "current_game" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("tgId")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" UUID NOT NULL,
    "status" "GameStatus" NOT NULL DEFAULT 'waiting',
    "currentPlayer" TEXT NOT NULL DEFAULT 'cross',
    "winLineStart" JSONB,
    "winLineEnd" JSONB,
    "winDirection" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Square" (
    "id" UUID NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "figure" TEXT,
    "gameId" UUID NOT NULL,

    CONSTRAINT "Square_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Square_x_y_gameId_key" ON "Square"("x", "y", "gameId");

-- AddForeignKey
ALTER TABLE "Square" ADD CONSTRAINT "Square_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
