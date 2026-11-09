-- Order chat between customer, rider and business. Additive only.
CREATE TABLE IF NOT EXISTS "OrderChatMessage" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "senderId" TEXT,
    "senderRole" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'TEXT',
    "body" TEXT NOT NULL,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "hidden" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "readAt" TIMESTAMP(3),
    "reportedAt" TIMESTAMP(3),
    "reportReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderChatMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "OrderChatMessage_orderId_channel_createdAt_idx" ON "OrderChatMessage"("orderId", "channel", "createdAt");
CREATE INDEX IF NOT EXISTS "OrderChatMessage_senderId_createdAt_idx" ON "OrderChatMessage"("senderId", "createdAt");
ALTER TABLE "OrderChatMessage" ADD CONSTRAINT "OrderChatMessage_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
