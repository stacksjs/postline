CREATE TABLE IF NOT EXISTS "dm_messages" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "provider" TEXT CHECK ("provider" IN ('bluesky', 'twitter', 'mastodon', 'instagram')) not null,
  "remote_id" TEXT not null,
  "direction" TEXT CHECK ("direction" IN ('incoming', 'outgoing')) not null,
  "author_handle" TEXT not null,
  "author_name" TEXT,
  "body" TEXT not null,
  "status" TEXT CHECK ("status" IN ('received', 'sent', 'failed')) not null default 'received',
  "failure_reason" TEXT,
  "sent_at" TEXT not null,
  "dm_conversation_id" INTEGER REFERENCES "dm_conversations"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "dm_messages_conversation_remote_id_unique" ON "dm_messages" ("dm_conversation_id", "remote_id");
CREATE INDEX IF NOT EXISTS "dm_messages_conversation_sent_at_index" ON "dm_messages" ("dm_conversation_id", "sent_at");
CREATE UNIQUE INDEX IF NOT EXISTS "dm_messages_uuid_unique" ON "dm_messages" ("uuid");
