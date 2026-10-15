-- Initialize the approved Sapele operating area for address and order APIs.
WITH country AS (
  INSERT INTO "Country" ("id", "name", "code")
  VALUES ('doorstep-initial-country-ng', 'Nigeria', 'NG')
  ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name"
  RETURNING "id"
),
state AS (
  INSERT INTO "State" ("id", "name", "countryId")
  SELECT 'doorstep-initial-state-delta', 'Delta State', country."id"
  FROM country
  ON CONFLICT ("countryId", "name") DO UPDATE SET "name" = EXCLUDED."name"
  RETURNING "id", "countryId"
),
city AS (
  INSERT INTO "City" ("id", "name", "stateId")
  SELECT 'doorstep-initial-city-sapele', 'Sapele', state."id"
  FROM state
  ON CONFLICT ("stateId", "name") DO UPDATE SET "name" = EXCLUDED."name"
  RETURNING "id", "stateId"
)
INSERT INTO "ServiceArea" (
  "id",
  "countryId",
  "stateId",
  "cityId",
  "enabled",
  "currency",
  "timezone",
  "createdAt",
  "updatedAt"
)
SELECT
  'doorstep-initial-service-area-sapele',
  country."id",
  state."id",
  city."id",
  TRUE,
  'NGN',
  'Africa/Lagos',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM country
CROSS JOIN state
CROSS JOIN city
ON CONFLICT ("countryId", "stateId", "cityId") DO UPDATE
SET "enabled" = TRUE,
    "currency" = 'NGN',
    "timezone" = 'Africa/Lagos',
    "updatedAt" = CURRENT_TIMESTAMP;
