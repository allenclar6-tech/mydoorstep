-- Live delivery handling: auto-dispatch offers, proof-of-delivery code attempts, stuck-order alerts.
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "codeAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "proofMethod" TEXT;
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "stuckAlertedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Delivery_status_requestExpiresAt_idx" ON "Delivery"("status", "requestExpiresAt");

CREATE TABLE IF NOT EXISTS "DispatchOffer" (
  "id" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "riderId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OFFERED',
  "distanceMeters" INTEGER,
  "offeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "respondedAt" TIMESTAMP(3),
  CONSTRAINT "DispatchOffer_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DispatchOffer_deliveryId_offeredAt_idx" ON "DispatchOffer"("deliveryId", "offeredAt");
CREATE INDEX IF NOT EXISTS "DispatchOffer_riderId_offeredAt_idx" ON "DispatchOffer"("riderId", "offeredAt");
DO $$ BEGIN
  ALTER TABLE "DispatchOffer" ADD CONSTRAINT "DispatchOffer_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "DispatchOffer" ADD CONSTRAINT "DispatchOffer_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
