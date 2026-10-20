-- Sapele location directory with verification evidence and separately approved delivery coverage.
CREATE TABLE IF NOT EXISTS "Location" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "originalCandidateName" TEXT,
  "alternativeNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "state" TEXT NOT NULL DEFAULT 'Delta',
  "localGovernmentArea" TEXT NOT NULL DEFAULT 'Sapele',
  "localityType" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "parentId" TEXT,
  "latitude" DECIMAL(10,7),
  "longitude" DECIMAL(10,7),
  "referenceLatitude" DECIMAL(10,7),
  "referenceLongitude" DECIMAL(10,7),
  "referenceSource" TEXT,
  "nearestLandmark" TEXT,
  "verificationStatus" TEXT NOT NULL DEFAULT 'pending',
  "verificationMethod" TEXT,
  "verificationSource" TEXT,
  "verificationSourceUrl" TEXT,
  "verificationCheckedAt" TIMESTAMP(3),
  "verificationNotes" TEXT,
  "reviewerId" TEXT,
  "evidence" JSONB NOT NULL DEFAULT '[]',
  "coverageMethod" TEXT,
  "boundaryGeometry" JSONB,
  "coverageRadiusMeters" INTEGER,
  "radiusLimitationsAcceptedById" TEXT,
  "boundaryVerificationStatus" TEXT NOT NULL DEFAULT 'none',
  "boundaryNotes" TEXT,
  "boundaryApprovedById" TEXT,
  "boundaryApprovedAt" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "deliveryEnabled" BOOLEAN NOT NULL DEFAULT false,
  "customerSurchargeMinor" INTEGER NOT NULL DEFAULT 0,
  "riderBonusMinor" INTEGER NOT NULL DEFAULT 0,
  "minimumOrderMinor" INTEGER,
  "closedUntil" TIMESTAMP(3),
  "closedReason" TEXT,
  "mergedIntoId" TEXT,
  "candidateNumber" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Location_slug_key" ON "Location"("slug");
CREATE INDEX IF NOT EXISTS "Location_verificationStatus_idx" ON "Location"("verificationStatus");
CREATE INDEX IF NOT EXISTS "Location_isActive_deliveryEnabled_idx" ON "Location"("isActive", "deliveryEnabled");
CREATE INDEX IF NOT EXISTS "Location_parentId_idx" ON "Location"("parentId");
DO $$ BEGIN
  ALTER TABLE "Location" ADD CONSTRAINT "Location_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "LocationReview" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "submittedById" TEXT NOT NULL,
  "submitterRole" TEXT NOT NULL,
  "confirmationType" TEXT NOT NULL,
  "nameConfirmed" BOOLEAN NOT NULL,
  "suggestedName" TEXT,
  "suggestedLatitude" DECIMAL(10,7),
  "suggestedLongitude" DECIMAL(10,7),
  "landmark" TEXT,
  "notes" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
  "decidedById" TEXT,
  "decidedAt" TIMESTAMP(3),
  "decisionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LocationReview_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LocationReview_locationId_status_idx" ON "LocationReview"("locationId", "status");
CREATE INDEX IF NOT EXISTS "LocationReview_status_createdAt_idx" ON "LocationReview"("status", "createdAt");
DO $$ BEGIN
  ALTER TABLE "LocationReview" ADD CONSTRAINT "LocationReview_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
