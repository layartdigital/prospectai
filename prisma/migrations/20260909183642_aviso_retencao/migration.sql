/*
  Warnings:

  - A unique constraint covering the columns `[tenantId,dedupeKey]` on the table `notifications` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'RETENTION_EXPIRING';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "dedupeKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "notifications_tenantId_dedupeKey_key" ON "notifications"("tenantId", "dedupeKey");
