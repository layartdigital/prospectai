-- CreateEnum
CREATE TYPE "SegmentLocaleStatus" AS ENUM ('GERADO', 'VALIDADO', 'CURADO');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "segmentId" TEXT;

-- CreateTable
CREATE TABLE "segments" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "macroSegment" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "specialty" TEXT,
    "services" TEXT[],
    "targetSectors" TEXT[],
    "opportunitySignals" TEXT[],
    "painPoints" TEXT,
    "contractModel" TEXT,
    "recurrence" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segment_locales" (
    "id" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "searchTerms" TEXT[],
    "status" "SegmentLocaleStatus" NOT NULL DEFAULT 'GERADO',
    "validatedAt" TIMESTAMP(3),
    "resultCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "segment_locales_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "segments_externalId_key" ON "segments"("externalId");

-- CreateIndex
CREATE INDEX "segments_macroSegment_idx" ON "segments"("macroSegment");

-- CreateIndex
CREATE INDEX "segments_isActive_idx" ON "segments"("isActive");

-- CreateIndex
CREATE INDEX "segment_locales_country_status_idx" ON "segment_locales"("country", "status");

-- CreateIndex
CREATE UNIQUE INDEX "segment_locales_segmentId_locale_key" ON "segment_locales"("segmentId", "locale");

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "segments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment_locales" ADD CONSTRAINT "segment_locales_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "segments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
