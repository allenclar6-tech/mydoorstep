-- Live support chat: last activity for sorting the agent inbox, the agent handling a ticket,
-- and photo attachments on individual messages. Additive only.
ALTER TABLE "SupportTicket" ADD COLUMN "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "SupportTicket" ADD COLUMN "assignedToId" TEXT;
UPDATE "SupportTicket" t SET "lastMessageAt" = COALESCE((SELECT MAX(m."createdAt") FROM "SupportMessage" m WHERE m."ticketId" = t."id"), t."createdAt");
CREATE INDEX "SupportTicket_status_lastMessageAt_idx" ON "SupportTicket"("status", "lastMessageAt");
ALTER TABLE "SupportMessage" ADD COLUMN "attachments" JSONB;
