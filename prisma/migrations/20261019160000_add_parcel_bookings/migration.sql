-- Parcel (send-a-package) bookings. Additive: existing food orders keep working.
CREATE TYPE "ParcelStatus" AS ENUM ('PENDING_PAYMENT', 'PAYMENT_CONFIRMED', 'SEARCHING_FOR_RIDER', 'RIDER_ASSIGNED', 'RIDER_EN_ROUTE_TO_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED');

CREATE TABLE "ParcelBooking" (
  "id" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "idempotencyKey" TEXT,
  "customerId" TEXT NOT NULL,
  "riderId" TEXT,
  "serviceCode" TEXT NOT NULL,
  "serviceName" TEXT NOT NULL,
  "pickupAddress" TEXT NOT NULL,
  "pickupLatitude" DECIMAL(10,7) NOT NULL,
  "pickupLongitude" DECIMAL(10,7) NOT NULL,
  "pickupContactName" TEXT NOT NULL,
  "pickupContactPhone" TEXT NOT NULL,
  "pickupNotes" TEXT,
  "dropoffAddress" TEXT NOT NULL,
  "dropoffLatitude" DECIMAL(10,7) NOT NULL,
  "dropoffLongitude" DECIMAL(10,7) NOT NULL,
  "recipientName" TEXT NOT NULL,
  "recipientPhone" TEXT NOT NULL,
  "packageDescription" TEXT NOT NULL,
  "packageSize" TEXT NOT NULL,
  "deliveryInstructions" TEXT,
  "distanceMeters" INTEGER NOT NULL,
  "durationSeconds" INTEGER NOT NULL,
  "routeGeometry" JSONB NOT NULL,
  "routeProvider" TEXT NOT NULL,
  "baseFeeMinor" INTEGER NOT NULL,
  "distanceFeeMinor" INTEGER NOT NULL,
  "minimumFareAdjustmentMinor" INTEGER NOT NULL DEFAULT 0,
  "serviceFeeMinor" INTEGER NOT NULL,
  "totalMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'NGN',
  "pricingSnapshot" JSONB NOT NULL,
  "status" "ParcelStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
  "riderRating" INTEGER,
  "paidAt" TIMESTAMP(3),
  "assignedAt" TIMESTAMP(3),
  "pickedUpAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "cancellationReason" TEXT,
  "cancelledByRole" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ParcelBooking_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ParcelBooking_reference_key" ON "ParcelBooking"("reference");
CREATE UNIQUE INDEX "ParcelBooking_idempotencyKey_key" ON "ParcelBooking"("idempotencyKey");
CREATE INDEX "ParcelBooking_customerId_createdAt_idx" ON "ParcelBooking"("customerId", "createdAt");
CREATE INDEX "ParcelBooking_status_createdAt_idx" ON "ParcelBooking"("status", "createdAt");
CREATE INDEX "ParcelBooking_riderId_status_idx" ON "ParcelBooking"("riderId", "status");
ALTER TABLE "ParcelBooking" ADD CONSTRAINT "ParcelBooking_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ParcelBooking" ADD CONSTRAINT "ParcelBooking_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ParcelBooking" ADD CONSTRAINT "ParcelBooking_riderRating_check" CHECK ("riderRating" IS NULL OR ("riderRating" BETWEEN 1 AND 5));
ALTER TABLE "ParcelBooking" ADD CONSTRAINT "ParcelBooking_amounts_check" CHECK ("totalMinor" > 0 AND "distanceMeters" > 0);

CREATE TABLE "ParcelEvent" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "status" "ParcelStatus" NOT NULL,
  "actorId" TEXT,
  "actorRole" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ParcelEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ParcelEvent_bookingId_createdAt_idx" ON "ParcelEvent"("bookingId", "createdAt");
ALTER TABLE "ParcelEvent" ADD CONSTRAINT "ParcelEvent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "ParcelBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Deliveries and payments may now belong to either a food order or a parcel booking (exactly one).
ALTER TABLE "Delivery" ALTER COLUMN "orderId" DROP NOT NULL;
ALTER TABLE "Delivery" ADD COLUMN "parcelBookingId" TEXT, ADD COLUMN "requestedRiderId" TEXT, ADD COLUMN "requestExpiresAt" TIMESTAMP(3), ADD COLUMN "cancelledAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Delivery_parcelBookingId_key" ON "Delivery"("parcelBookingId");
CREATE INDEX "Delivery_requestedRiderId_status_idx" ON "Delivery"("requestedRiderId", "status");
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_parcelBookingId_fkey" FOREIGN KEY ("parcelBookingId") REFERENCES "ParcelBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_single_owner_check" CHECK (("orderId" IS NOT NULL) <> ("parcelBookingId" IS NOT NULL));

ALTER TABLE "Payment" ALTER COLUMN "orderId" DROP NOT NULL;
ALTER TABLE "Payment" ADD COLUMN "parcelBookingId" TEXT;
CREATE UNIQUE INDEX "Payment_parcelBookingId_key" ON "Payment"("parcelBookingId");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_parcelBookingId_fkey" FOREIGN KEY ("parcelBookingId") REFERENCES "ParcelBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_single_owner_check" CHECK (("orderId" IS NOT NULL) <> ("parcelBookingId" IS NOT NULL));

-- Opt-in, approximate position a rider shares while online (used only server-side for arrival estimates).
ALTER TABLE "Rider" ADD COLUMN "availabilityLatitude" DECIMAL(10,7), ADD COLUMN "availabilityLongitude" DECIMAL(10,7), ADD COLUMN "availabilityAccuracyM" INTEGER, ADD COLUMN "availabilityLocatedAt" TIMESTAMP(3);
CREATE INDEX "Rider_status_availability_idx" ON "Rider"("status", "availability");
