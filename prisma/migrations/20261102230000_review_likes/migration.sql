-- Glovo-style reviews: thumbs-up share per store, and per-item thumbs on each review.
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "ratingLikes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Review" ADD COLUMN IF NOT EXISTS "itemFeedback" JSONB;
-- Existing reviews: 4 or 5 stars count as a thumbs-up.
UPDATE "Restaurant" r SET "ratingLikes" = (SELECT COUNT(*) FROM "Review" v WHERE v."restaurantId" = r."id" AND v."rating" >= 4);
