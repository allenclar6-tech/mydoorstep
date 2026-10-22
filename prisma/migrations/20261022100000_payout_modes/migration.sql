-- Glovo-style payouts: automatic, scheduled and self-service cash-outs, plus per-business commission rates.
ALTER TABLE "Payout" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'ADMIN';
ALTER TABLE "Payout" ADD COLUMN IF NOT EXISTS "feeMinor" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "Payout_restaurantId_createdAt_idx" ON "Payout"("restaurantId", "createdAt");
CREATE INDEX IF NOT EXISTS "Payout_riderId_createdAt_idx" ON "Payout"("riderId", "createdAt");
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "commissionDoorstepRiderPercent" DECIMAL(5,2);
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "commissionOwnRiderPercent" DECIMAL(5,2);
