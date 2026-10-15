-- CreateEnum
CREATE TYPE "StoreType" AS ENUM ('RESTAURANT', 'GROCERY');

-- AlterTable
ALTER TABLE "Restaurant"
ADD COLUMN "coverImageUrl" TEXT,
ADD COLUMN "storeType" "StoreType" NOT NULL DEFAULT 'RESTAURANT';
