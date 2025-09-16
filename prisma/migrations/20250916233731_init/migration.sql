-- CreateEnum
CREATE TYPE "RewardType" AS ENUM ('enter', 'daily', 'new', 'unique');

-- CreateEnum
CREATE TYPE "GameType" AS ENUM ('dot', 'blot', 'xo');

-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('waiting', 'started', 'finished');

-- CreateEnum
CREATE TYPE "WinReason" AS ENUM ('timeout', 'opponent_left', 'fair_win');

-- CreateEnum
CREATE TYPE "BlotSize" AS ENUM ('small', 'medium', 'big');

-- CreateTable
CREATE TABLE "users" (
    "tgId" TEXT NOT NULL,
    "invited_by" TEXT,
    "balance" INTEGER NOT NULL DEFAULT 120,
    "username" TEXT NOT NULL,
    "photo_url" TEXT NOT NULL,
    "current_game" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDate" TIMESTAMP(3),
    "ip_address" TEXT,
    "is_premium" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("tgId")
);

-- CreateTable
CREATE TABLE "games" (
    "id" UUID NOT NULL,
    "status" "GameStatus" NOT NULL DEFAULT 'waiting',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "moves" INTEGER NOT NULL DEFAULT 0,
    "gameType" "GameType" NOT NULL,
    "winLines" INTEGER,
    "dot_size" INTEGER,
    "blot_size" "BlotSize",
    "winReason" "WinReason",
    "creatorId" TEXT NOT NULL,
    "joinerId" TEXT,
    "creatorSocketId" TEXT NOT NULL,
    "joinerSocketId" TEXT,
    "winnerId" TEXT,
    "creatorTimeLeftMs" INTEGER,
    "joinerTimeLeftMs" INTEGER,

    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rewards" (
    "id" SERIAL NOT NULL,
    "reward_type" "RewardType" NOT NULL,
    "meaning" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rewards_userId_createdAt_idx" ON "rewards"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "payments_userId_createdAt_idx" ON "payments"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("tgId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("tgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_joinerId_fkey" FOREIGN KEY ("joinerId") REFERENCES "users"("tgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("tgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("tgId") ON DELETE CASCADE ON UPDATE CASCADE;
