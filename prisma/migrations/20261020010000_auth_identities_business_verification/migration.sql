-- Google sign-in, registered/non-registered businesses and registry checks. Additive only: no data is removed.

-- Accounts created with Google have no password until the person sets one.
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;

CREATE TABLE "AuthIdentity" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "email" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AuthIdentity_provider_subject_key" ON "AuthIdentity"("provider", "subject");
CREATE UNIQUE INDEX "AuthIdentity_userId_provider_key" ON "AuthIdentity"("userId", "provider");
ALTER TABLE "AuthIdentity" ADD CONSTRAINT "AuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TYPE "BusinessRegistrationType" AS ENUM ('REGISTERED', 'NOT_REGISTERED');
CREATE TYPE "BusinessVerificationStatus" AS ENUM ('NOT_SUBMITTED', 'PENDING_REVIEW', 'VERIFIED', 'NON_REGISTERED', 'ACTION_REQUIRED', 'REJECTED');

ALTER TABLE "RestaurantApplication"
  ADD COLUMN "registrationType" "BusinessRegistrationType",
  ADD COLUMN "businessVerificationStatus" "BusinessVerificationStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
  ADD COLUMN "businessVerificationNote" TEXT,
  ADD COLUMN "businessVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "businessVerifiedById" TEXT;

-- Existing applications that gave a registration number are treated as registered and waiting for review.
-- Nothing is marked verified automatically.
UPDATE "RestaurantApplication"
SET "registrationType" = 'REGISTERED', "businessVerificationStatus" = 'PENDING_REVIEW'
WHERE "registrationNumber" IS NOT NULL AND btrim("registrationNumber") <> '';

ALTER TABLE "RiderApplication" ADD COLUMN "identityCheckConsentAt" TIMESTAMP(3);

CREATE TABLE "VerificationCheck" (
  "id" TEXT NOT NULL,
  "subjectType" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "checkType" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "summary" JSONB,
  "providerReference" TEXT,
  "actorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VerificationCheck_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VerificationCheck_subjectType_subjectId_createdAt_idx" ON "VerificationCheck"("subjectType", "subjectId", "createdAt");

-- When a rider last switched online/offline, so the app can show "online for 2h".
ALTER TABLE "Rider" ADD COLUMN "availabilityChangedAt" TIMESTAMP(3);
