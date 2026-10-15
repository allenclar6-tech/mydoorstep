ALTER TABLE "User"
  ADD COLUMN "preferredLanguage" TEXT;

ALTER TABLE "Restaurant"
  ADD COLUMN "prepTimeMinutes" INTEGER,
  ADD COLUMN "minimumOrderMinor" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "cuisineCategory" TEXT;

ALTER TABLE "RestaurantApplication"
  ADD COLUMN "deliveryPreference" TEXT,
  ADD COLUMN "businessCategory" TEXT,
  ADD COLUMN "registrationNumber" TEXT,
  ADD COLUMN "whatsApp" TEXT;

ALTER TABLE "RiderApplication"
  ADD COLUMN "preferredArea" TEXT,
  ADD COLUMN "typicalAvailability" TEXT,
  ADD COLUMN "vehicleOwnership" TEXT;
