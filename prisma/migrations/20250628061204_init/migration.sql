-- CreateEnum
CREATE TYPE "GameType" AS ENUM ('dot', 'blot', 'xo');

-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('waiting', 'started', 'finished');

-- CreateEnum
CREATE TYPE "WinReason" AS ENUM ('timeout', 'opponent_left', 'fair_win');

-- CreateTable
CREATE TABLE "users" (
    "tgId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 70,
    "username" TEXT NOT NULL,
    "photo_url" TEXT NOT NULL,
    "current_game" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("tgId")
);

-- CreateTable
CREATE TABLE "games" (
    "id" UUID NOT NULL,
    "status" "GameStatus" NOT NULL DEFAULT 'waiting',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "gameType" "GameType" NOT NULL,
    "winLines" INTEGER,
    "size" INTEGER,
    "winReason" "WinReason",
    "creatorId" TEXT NOT NULL,
    "joinerId" TEXT,
    "isJoinerFirstTime" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("tgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_joinerId_fkey" FOREIGN KEY ("joinerId") REFERENCES "users"("tgId") ON DELETE CASCADE ON UPDATE CASCADE;
