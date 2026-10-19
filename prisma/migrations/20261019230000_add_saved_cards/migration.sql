-- Saved Paystack card authorizations (tokens only, encrypted) and add-card verification charges.
CREATE TABLE "SavedCard" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "authorizationCipher" TEXT NOT NULL,
  "signature" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "brand" TEXT,
  "bank" TEXT,
  "last4" TEXT NOT NULL,
  "expMonth" TEXT NOT NULL,
  "expYear" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  "removedAt" TIMESTAMP(3),
  CONSTRAINT "SavedCard_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SavedCard_userId_signature_key" ON "SavedCard"("userId", "signature");
CREATE INDEX "SavedCard_userId_removedAt_idx" ON "SavedCard"("userId", "removedAt");
ALTER TABLE "SavedCard" ADD CONSTRAINT "SavedCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SavedCard" ADD CONSTRAINT "SavedCard_last4_check" CHECK ("last4" ~ '^[0-9]{4}$');

CREATE TABLE "CardVerification" (
  "id" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "refundStatus" TEXT,
  "savedCardId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "CardVerification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CardVerification_reference_key" ON "CardVerification"("reference");
CREATE INDEX "CardVerification_userId_createdAt_idx" ON "CardVerification"("userId", "createdAt");
ALTER TABLE "CardVerification" ADD CONSTRAINT "CardVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
