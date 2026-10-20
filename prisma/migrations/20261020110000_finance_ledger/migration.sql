-- Money flows: business/rider payout accounts, an append-only ledger, payouts, and per-order split data.
-- Additive only; existing orders keep their recorded commission and payouts.
ALTER TABLE "Restaurant" ADD COLUMN "latitude" DECIMAL(10,7), ADD COLUMN "longitude" DECIMAL(10,7);

ALTER TABLE "Order"
  ADD COLUMN "fulfilment" TEXT,
  ADD COLUMN "commissionPercent" DECIMAL(5,2),
  ADD COLUMN "partnerShareMinor" INTEGER,
  ADD COLUMN "deliveryDistanceMeters" INTEGER,
  ADD COLUMN "splitSubaccountCode" TEXT;

CREATE TABLE "PayoutAccount" (
  "id" TEXT NOT NULL,
  "ownerType" TEXT NOT NULL,
  "restaurantId" TEXT,
  "riderId" TEXT,
  "bankCode" TEXT NOT NULL,
  "bankName" TEXT NOT NULL,
  "accountName" TEXT NOT NULL,
  "accountLast4" TEXT NOT NULL,
  "paystackSubaccountCode" TEXT,
  "paystackRecipientCode" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "verifiedAt" TIMESTAMP(3),
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayoutAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PayoutAccount_restaurantId_key" ON "PayoutAccount"("restaurantId");
CREATE UNIQUE INDEX "PayoutAccount_riderId_key" ON "PayoutAccount"("riderId");
ALTER TABLE "PayoutAccount" ADD CONSTRAINT "PayoutAccount_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayoutAccount" ADD CONSTRAINT "PayoutAccount_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "LedgerEntry" (
  "id" TEXT NOT NULL,
  "party" TEXT NOT NULL,
  "restaurantId" TEXT,
  "riderId" TEXT,
  "orderId" TEXT,
  "parcelBookingId" TEXT,
  "type" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "payoutId" TEXT,
  "dedupeKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LedgerEntry_dedupeKey_key" ON "LedgerEntry"("dedupeKey");
CREATE INDEX "LedgerEntry_party_status_idx" ON "LedgerEntry"("party", "status");
CREATE INDEX "LedgerEntry_restaurantId_createdAt_idx" ON "LedgerEntry"("restaurantId", "createdAt");
CREATE INDEX "LedgerEntry_riderId_createdAt_idx" ON "LedgerEntry"("riderId", "createdAt");
CREATE INDEX "LedgerEntry_payoutId_idx" ON "LedgerEntry"("payoutId");

CREATE TABLE "Payout" (
  "id" TEXT NOT NULL,
  "party" TEXT NOT NULL,
  "restaurantId" TEXT,
  "riderId" TEXT,
  "amountMinor" INTEGER NOT NULL,
  "method" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "reference" TEXT NOT NULL,
  "transferCode" TEXT,
  "failureReason" TEXT,
  "bankSnapshot" JSONB,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Payout_reference_key" ON "Payout"("reference");
CREATE INDEX "Payout_party_status_idx" ON "Payout"("party", "status");
