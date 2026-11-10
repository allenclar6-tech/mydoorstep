-- Rider road reports with admin review. Additive only.
CREATE TABLE IF NOT EXISTS "RoadReport" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "orderId" TEXT,
    "kind" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "distanceKm" DECIMAL(6,2),
    "extraChargeMinor" INTEGER,
    "note" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RoadReport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "RoadReport_status_createdAt_idx" ON "RoadReport"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "RoadReport_riderId_createdAt_idx" ON "RoadReport"("riderId", "createdAt");
CREATE INDEX IF NOT EXISTS "RoadReport_area_status_idx" ON "RoadReport"("area", "status");
