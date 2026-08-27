/*
  Warnings:

  - A unique constraint covering the columns `[tenantId,leadId]` on the table `lead_digital_presences` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenantId,leadId]` on the table `lead_scores` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenantId,id]` on the table `lead_scores` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenantId,leadId]` on the table `lead_source_records` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenantId,id]` on the table `leads` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenantId,id]` on the table `pipeline_cards` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenantId,id]` on the table `tags` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `tenantId` to the `lead_tags` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "lead_digital_presences" DROP CONSTRAINT "lead_digital_presences_leadId_fkey";

-- DropForeignKey
ALTER TABLE "lead_score_reasons" DROP CONSTRAINT "lead_score_reasons_scoreId_fkey";

-- DropForeignKey
ALTER TABLE "lead_scores" DROP CONSTRAINT "lead_scores_leadId_fkey";

-- DropForeignKey
ALTER TABLE "lead_source_records" DROP CONSTRAINT "lead_source_records_leadId_fkey";

-- DropForeignKey
ALTER TABLE "lead_tags" DROP CONSTRAINT "lead_tags_leadId_fkey";

-- DropForeignKey
ALTER TABLE "lead_tags" DROP CONSTRAINT "lead_tags_tagId_fkey";

-- DropForeignKey
ALTER TABLE "pipeline_transitions" DROP CONSTRAINT "pipeline_transitions_cardId_fkey";

-- AlterTable
ALTER TABLE "lead_tags" ADD COLUMN     "tenantId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "lead_digital_presences_tenantId_leadId_key" ON "lead_digital_presences"("tenantId", "leadId");

-- CreateIndex
CREATE INDEX "lead_score_reasons_tenantId_scoreId_idx" ON "lead_score_reasons"("tenantId", "scoreId");

-- CreateIndex
CREATE UNIQUE INDEX "lead_scores_tenantId_leadId_key" ON "lead_scores"("tenantId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "lead_scores_tenantId_id_key" ON "lead_scores"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_source_records_tenantId_leadId_key" ON "lead_source_records"("tenantId", "leadId");

-- CreateIndex
CREATE INDEX "lead_tags_tenantId_idx" ON "lead_tags"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "leads_tenantId_id_key" ON "leads"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_cards_tenantId_id_key" ON "pipeline_cards"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tags_tenantId_id_key" ON "tags"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "lead_source_records" ADD CONSTRAINT "lead_source_records_tenantId_leadId_fkey" FOREIGN KEY ("tenantId", "leadId") REFERENCES "leads"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_digital_presences" ADD CONSTRAINT "lead_digital_presences_tenantId_leadId_fkey" FOREIGN KEY ("tenantId", "leadId") REFERENCES "leads"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_scores" ADD CONSTRAINT "lead_scores_tenantId_leadId_fkey" FOREIGN KEY ("tenantId", "leadId") REFERENCES "leads"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_score_reasons" ADD CONSTRAINT "lead_score_reasons_tenantId_scoreId_fkey" FOREIGN KEY ("tenantId", "scoreId") REFERENCES "lead_scores"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_transitions" ADD CONSTRAINT "pipeline_transitions_tenantId_cardId_fkey" FOREIGN KEY ("tenantId", "cardId") REFERENCES "pipeline_cards"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_tenantId_leadId_fkey" FOREIGN KEY ("tenantId", "leadId") REFERENCES "leads"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_tenantId_tagId_fkey" FOREIGN KEY ("tenantId", "tagId") REFERENCES "tags"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
