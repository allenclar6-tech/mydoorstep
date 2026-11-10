-- Dispatch control: rider "arrived" time and failed-delivery records. Additive only.
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "arrivedAtCustomerAt" TIMESTAMP(3);
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "failedAt" TIMESTAMP(3);
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "failureReason" TEXT;
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "failureNote" TEXT;
