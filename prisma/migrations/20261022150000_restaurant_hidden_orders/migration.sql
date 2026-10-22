-- "Clear" on the business order board: finished orders are hidden from the board, never erased
-- (payments, payouts and reports still include them).
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "restaurantHiddenAt" TIMESTAMP(3);
