-- CreateTable
CREATE TABLE "outreach_message_deliveries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "outreach_message_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider_ref" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "sent_by_identity_id" TEXT NOT NULL,
    "sent_at" DATETIME NOT NULL,
    CONSTRAINT "outreach_message_deliveries_outreach_message_id_fkey" FOREIGN KEY ("outreach_message_id") REFERENCES "outreach_messages" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "outreach_message_deliveries_outreach_message_id_idx" ON "outreach_message_deliveries"("outreach_message_id");

-- CreateIndex
CREATE INDEX "outreach_message_deliveries_status_idx" ON "outreach_message_deliveries"("status");
