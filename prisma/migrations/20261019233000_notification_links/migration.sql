-- Notifications can point at the screen they are about (an order, a parcel, an application).
ALTER TABLE "Notification" ADD COLUMN "link" TEXT;

CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
