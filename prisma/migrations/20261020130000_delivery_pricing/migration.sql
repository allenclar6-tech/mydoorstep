-- Distance-based Sapele delivery pricing: each order keeps the rider pay and price breakdown fixed at checkout,
-- so later rate changes never rewrite what was agreed.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "plannedRiderPayMinor" INTEGER;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveryQuote" JSONB;
