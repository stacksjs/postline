CREATE TABLE IF NOT EXISTS "notifications" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "type" TEXT CHECK ("type" IN ('email', 'sms', 'push', 'slack', 'webhook')) not null,
  "channel" TEXT,
  "recipient" TEXT not null,
  "subject" TEXT not null,
  "body" TEXT,
  "status" TEXT CHECK ("status" IN ('pending', 'sent', 'delivered', 'failed', 'read')) not null default 'pending',
  "read_at" TEXT,
  "sent_at" TEXT,
  "metadata" TEXT,
  "user_id" INTEGER REFERENCES "users"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_notifications_uuid_unique" ON "notifications" ("uuid");
