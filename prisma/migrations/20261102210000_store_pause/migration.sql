-- Timed store pause (Glovo-style "pause for 30 minutes").
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "pausedUntil" TIMESTAMP(3);
