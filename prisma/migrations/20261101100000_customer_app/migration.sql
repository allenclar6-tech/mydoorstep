-- Customer app: pickup and scheduled orders, rider tips, promo codes and store sections.
-- Additive only: existing orders keep working as ordinary delivery orders.

ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "vertical" TEXT;
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "pickupEnabled" BOOLEAN NOT NULL DEFAULT true;

-- Existing businesses: restaurants are Food; pharmacies go to Pharmacy & Beauty; specialty stores to Shops;
-- everything else that is a grocery stays in Groceries.
UPDATE "Restaurant" SET "vertical" = 'FOOD' WHERE "vertical" IS NULL AND "storeType" = 'RESTAURANT';
UPDATE "Restaurant" r SET "vertical" = 'PHARMACY_BEAUTY' FROM "RestaurantApplication" a
  WHERE a."restaurantId" = r."id" AND r."vertical" IS NULL AND a."businessCategory" IN ('pharmacy', 'beauty');
UPDATE "Restaurant" r SET "vertical" = 'SHOPS' FROM "RestaurantApplication" a
  WHERE a."restaurantId" = r."id" AND r."vertical" IS NULL AND a."businessCategory" IN ('specialty_store', 'electronics', 'fashion', 'phones', 'general_shop');
UPDATE "Restaurant" SET "vertical" = 'GROCERIES' WHERE "vertical" IS NULL AND "storeType" = 'GROCERY';

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "orderType" TEXT NOT NULL DEFAULT 'DELIVERY';
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "scheduledFor" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "tipMinor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "promotionId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "promoCode" TEXT;

ALTER TABLE "Promotion" ADD COLUMN IF NOT EXISTS "maxDiscountMinor" INTEGER;
ALTER TABLE "Promotion" ADD COLUMN IF NOT EXISTS "minSubtotalMinor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Promotion" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "Promotion" ADD COLUMN IF NOT EXISTS "perCustomerLimit" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Promotion" ADD COLUMN IF NOT EXISTS "firstOrderOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Promotion" ADD COLUMN IF NOT EXISTS "autoApply" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Promotion" ADD COLUMN IF NOT EXISTS "showInApp" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Promotion" ADD COLUMN IF NOT EXISTS "vertical" TEXT;
ALTER TABLE "Promotion" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

DO $$ BEGIN
  ALTER TABLE "Order" ADD CONSTRAINT "Order_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "Order_promotionId_customerId_idx" ON "Order"("promotionId", "customerId");
