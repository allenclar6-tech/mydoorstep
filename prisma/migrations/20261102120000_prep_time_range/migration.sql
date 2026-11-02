-- Businesses can give a preparation-time range (e.g. 45–70 minutes) instead of one number.
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "prepTimeMaxMinutes" INTEGER;
