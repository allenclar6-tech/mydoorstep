-- Manual payouts are confirmed by the partner: "sent by DOORSTEP" → "received" (or disputed).
ALTER TABLE "Payout" ADD COLUMN IF NOT EXISTS "receiptKey" TEXT;
ALTER TABLE "Payout" ADD COLUMN IF NOT EXISTS "remindedAt" TIMESTAMP(3);
ALTER TABLE "Payout" ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3);
ALTER TABLE "Payout" ADD COLUMN IF NOT EXISTS "confirmedById" TEXT;
ALTER TABLE "Payout" ADD COLUMN IF NOT EXISTS "disputeNote" TEXT;
