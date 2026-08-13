-- AlterTable
ALTER TABLE "prospecting_searches" ADD COLUMN     "segmentLocaleId" TEXT;

-- AddForeignKey
ALTER TABLE "prospecting_searches" ADD CONSTRAINT "prospecting_searches_segmentLocaleId_fkey" FOREIGN KEY ("segmentLocaleId") REFERENCES "segment_locales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
