-- CreateEnum
CREATE TYPE "RestaurantMemberRole" AS ENUM ('OWNER', 'MANAGER', 'FINANCE', 'STAFF');

-- AlterTable
ALTER TABLE "RestaurantUser"
ADD COLUMN "role" "RestaurantMemberRole" NOT NULL DEFAULT 'OWNER';

-- CreateIndex
CREATE INDEX "RestaurantUser_restaurantId_role_idx" ON "RestaurantUser"("restaurantId", "role");
