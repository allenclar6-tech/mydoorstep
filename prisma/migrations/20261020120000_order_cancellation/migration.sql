-- "Remove from my orders": the order is hidden from the customer's list, never erased.
ALTER TABLE "Order" ADD COLUMN "customerHiddenAt" TIMESTAMP(3);
CREATE INDEX "Order_customerId_customerHiddenAt_createdAt_idx" ON "Order"("customerId", "customerHiddenAt", "createdAt");
