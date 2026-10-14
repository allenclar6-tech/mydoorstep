-- AlterEnum
ALTER TYPE "ApplicationStatus" ADD VALUE 'NEEDS_INFORMATION';

-- CreateTable
CREATE TABLE "ApplicationReview" (
  "id" TEXT NOT NULL,
  "applicationType" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "previousStatus" "ApplicationStatus" NOT NULL,
  "status" "ApplicationStatus" NOT NULL,
  "note" TEXT,
  "actorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApplicationReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApplicationReview_applicationType_applicationId_createdAt_idx"
ON "ApplicationReview"("applicationType", "applicationId", "createdAt");

-- AddForeignKey
ALTER TABLE "ApplicationReview"
ADD CONSTRAINT "ApplicationReview_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
