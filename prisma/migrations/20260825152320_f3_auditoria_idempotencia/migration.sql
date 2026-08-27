/*
  Warnings:

  - A unique constraint covering the columns `[tenantId,idempotencyKey]` on the table `digital_presence_audits` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "digital_presence_audits" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateIndex
CREATE INDEX "digital_presence_audits_tenantId_leadId_status_idx" ON "digital_presence_audits"("tenantId", "leadId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "digital_presence_audits_tenantId_idempotencyKey_key" ON "digital_presence_audits"("tenantId", "idempotencyKey");
