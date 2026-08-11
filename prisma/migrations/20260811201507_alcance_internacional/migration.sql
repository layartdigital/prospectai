-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('PF', 'PJ');

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'BR';

-- AlterTable
ALTER TABLE "prospecting_searches" ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'BR';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'BR',
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'BRL',
ADD COLUMN     "customerType" "CustomerType" NOT NULL DEFAULT 'PJ',
ADD COLUMN     "taxId" TEXT;
