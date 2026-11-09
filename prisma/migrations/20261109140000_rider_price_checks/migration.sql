-- Delivery prices are fixed between DOORSTEP admins and riders (customers only accept or decline).
-- Additive only: new nullable columns and one new table.

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "agreedRiderId" TEXT;

ALTER TABLE "DeliveryQuotation" ADD COLUMN IF NOT EXISTS "riderAskAt" TIMESTAMP(3);
ALTER TABLE "DeliveryQuotation" ADD COLUMN IF NOT EXISTS "riderAskPayMinor" INTEGER;
ALTER TABLE "DeliveryQuotation" ADD COLUMN IF NOT EXISTS "riderAskNote" TEXT;

ALTER TABLE "DeliveryQuotationVersion" ADD COLUMN IF NOT EXISTS "riderPayMinor" INTEGER;
ALTER TABLE "DeliveryQuotationVersion" ADD COLUMN IF NOT EXISTS "agreedRiderId" TEXT;

CREATE TABLE IF NOT EXISTS "RiderPriceSuggestion" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "amountMinor" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RiderPriceSuggestion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RiderPriceSuggestion_quotationId_riderId_key" ON "RiderPriceSuggestion"("quotationId", "riderId");
CREATE INDEX IF NOT EXISTS "RiderPriceSuggestion_riderId_updatedAt_idx" ON "RiderPriceSuggestion"("riderId", "updatedAt");
DO $$ BEGIN
  ALTER TABLE "RiderPriceSuggestion" ADD CONSTRAINT "RiderPriceSuggestion_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "DeliveryQuotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
