-- CreateEnum
CREATE TYPE "RiderNetwork" AS ENUM ('DOORSTEP_POOL', 'BUSINESS_OWNED');

-- AlterTable
ALTER TABLE "Rider" ADD COLUMN     "network" "RiderNetwork" NOT NULL DEFAULT 'DOORSTEP_POOL',
ADD COLUMN     "restaurantId" TEXT;

-- CreateIndex
CREATE INDEX "Rider_restaurantId_status_idx" ON "Rider"("restaurantId", "status");

-- AddForeignKey
ALTER TABLE "Rider" ADD CONSTRAINT "Rider_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

