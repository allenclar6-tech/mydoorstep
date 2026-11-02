-- Phone/computer push notifications (Web Push), and a one-time "finish paying" reminder for unpaid orders.
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "pushedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Notification_pushedAt_createdAt_idx" ON "Notification"("pushedAt", "createdAt");
-- Alerts that already exist are treated as sent, so nobody gets a burst of old notifications.
UPDATE "Notification" SET "pushedAt" = CURRENT_TIMESTAMP WHERE "pushedAt" IS NULL;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "paymentReminderAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "PushSubscription" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX IF NOT EXISTS "PushSubscription_userId_idx" ON "PushSubscription"("userId");
