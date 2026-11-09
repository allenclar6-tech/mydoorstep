-- Manual / negotiated delivery prices. Additive only: no existing data is changed.
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'AWAITING_DELIVERY_QUOTE' BEFORE 'PENDING_PAYMENT';

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveryPricingMethod" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "distanceStatus" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "locationConfidence" TEXT;

CREATE TABLE IF NOT EXISTS "DeliveryQuotation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "currentVersion" INTEGER NOT NULL DEFAULT 0,
    "acceptedVersion" INTEGER,
    "acceptedFeeMinor" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "reviewRounds" INTEGER NOT NULL DEFAULT 0,
    "estimateFeeMinor" INTEGER,
    "originalDistance" JSONB,
    "correctedDistanceKm" DECIMAL(8,2),
    "correctionReason" TEXT,
    "correctedById" TEXT,
    "correctedAt" TIMESTAMP(3),
    "pickupSnapshot" JSONB,
    "landmark" TEXT,
    "directions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DeliveryQuotation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DeliveryQuotation_orderId_key" ON "DeliveryQuotation"("orderId");
CREATE INDEX IF NOT EXISTS "DeliveryQuotation_status_updatedAt_idx" ON "DeliveryQuotation"("status", "updatedAt");
CREATE INDEX IF NOT EXISTS "DeliveryQuotation_expiresAt_idx" ON "DeliveryQuotation"("expiresAt");
ALTER TABLE "DeliveryQuotation" ADD CONSTRAINT "DeliveryQuotation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "DeliveryQuotationVersion" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "feeMinor" INTEGER NOT NULL,
    "pricingMethod" TEXT NOT NULL DEFAULT 'MANUAL_QUOTE',
    "explanation" TEXT,
    "internalNote" TEXT,
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OFFERED',
    "proposedById" TEXT NOT NULL,
    "customerResponse" TEXT,
    "customerMessage" TEXT,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeliveryQuotationVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DeliveryQuotationVersion_quotationId_version_key" ON "DeliveryQuotationVersion"("quotationId", "version");
ALTER TABLE "DeliveryQuotationVersion" ADD CONSTRAINT "DeliveryQuotationVersion_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "DeliveryQuotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "DeliveryQuotationEvent" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" TEXT NOT NULL,
    "fromFeeMinor" INTEGER,
    "toFeeMinor" INTEGER,
    "version" INTEGER,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeliveryQuotationEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DeliveryQuotationEvent_quotationId_createdAt_idx" ON "DeliveryQuotationEvent"("quotationId", "createdAt");
ALTER TABLE "DeliveryQuotationEvent" ADD CONSTRAINT "DeliveryQuotationEvent_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "DeliveryQuotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
