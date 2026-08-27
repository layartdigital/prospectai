-- CreateEnum
CREATE TYPE "AuditStatus" AS ENUM ('REQUESTED', 'QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SiteCheck" AS ENUM ('DNS', 'HTTP_REACHABLE', 'HTTPS', 'REDIRECT_CHAIN', 'VIEWPORT_META', 'TTFB', 'TITLE_META');

-- CreateEnum
CREATE TYPE "CheckOutcome" AS ENUM ('OK', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "plan_usages" ADD COLUMN     "auditsCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "digital_presence_audits" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "requestedById" TEXT,
    "auditVersion" TEXT NOT NULL,
    "status" "AuditStatus" NOT NULL DEFAULT 'REQUESTED',
    "queueJobId" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "digital_presence_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "digital_presence_checks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "check" "SiteCheck" NOT NULL,
    "outcome" "CheckOutcome" NOT NULL,
    "observedUrl" TEXT,
    "observedAt" TIMESTAMP(3),
    "result" JSONB,
    "errorCode" TEXT,
    "confidence" DOUBLE PRECISION,
    "retentionUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "digital_presence_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "digital_presence_audits_tenantId_leadId_createdAt_idx" ON "digital_presence_audits"("tenantId", "leadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "digital_presence_audits_tenantId_id_key" ON "digital_presence_audits"("tenantId", "id");

-- CreateIndex
CREATE INDEX "digital_presence_checks_tenantId_auditId_idx" ON "digital_presence_checks"("tenantId", "auditId");

-- CreateIndex
CREATE UNIQUE INDEX "digital_presence_checks_tenantId_id_key" ON "digital_presence_checks"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "digital_presence_audits" ADD CONSTRAINT "digital_presence_audits_tenantId_leadId_fkey" FOREIGN KEY ("tenantId", "leadId") REFERENCES "leads"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_presence_audits" ADD CONSTRAINT "digital_presence_audits_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_presence_checks" ADD CONSTRAINT "digital_presence_checks_tenantId_auditId_fkey" FOREIGN KEY ("tenantId", "auditId") REFERENCES "digital_presence_audits"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
