-- Add new card screen: nickname, cardholder name and a default card. No card numbers or CVCs are stored.
ALTER TABLE "SavedCard" ADD COLUMN IF NOT EXISTS "nickname" TEXT;
ALTER TABLE "SavedCard" ADD COLUMN IF NOT EXISTS "holderName" TEXT;
ALTER TABLE "SavedCard" ADD COLUMN IF NOT EXISTS "isDefault" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CardVerification" ADD COLUMN IF NOT EXISTS "nickname" TEXT;
ALTER TABLE "CardVerification" ADD COLUMN IF NOT EXISTS "holderName" TEXT;
