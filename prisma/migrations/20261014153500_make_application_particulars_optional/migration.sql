-- Supporting application particulars can be supplied after an applicant starts review.
ALTER TABLE "RestaurantApplication"
  ALTER COLUMN "identityType" DROP NOT NULL,
  ALTER COLUMN "identityNumber" DROP NOT NULL;

ALTER TABLE "RiderApplication"
  ALTER COLUMN "identityType" DROP NOT NULL,
  ALTER COLUMN "identityNumber" DROP NOT NULL,
  ALTER COLUMN "emergencyName" DROP NOT NULL,
  ALTER COLUMN "emergencyPhone" DROP NOT NULL;
