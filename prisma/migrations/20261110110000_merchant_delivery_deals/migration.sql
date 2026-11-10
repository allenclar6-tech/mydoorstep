-- Business delivery deals (who pays delivery) and the split recorded on each order and price version. Additive only.
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "deliveryDeal" JSONB;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveryFunding" JSONB;
ALTER TABLE "DeliveryQuotationVersion" ADD COLUMN IF NOT EXISTS "funding" JSONB;
