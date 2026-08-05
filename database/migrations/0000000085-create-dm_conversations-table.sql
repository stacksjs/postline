CREATE TABLE IF NOT EXISTS "dm_conversations" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "provider" TEXT CHECK ("provider" IN ('bluesky', 'twitter', 'mastodon', 'instagram')) not null,
  "remote_id" TEXT not null,
  "participant_handle" TEXT not null,
  "participant_name" TEXT,
  "participant_avatar" TEXT,
  "participant_remote_id" TEXT,
  "last_message_at" TEXT,
  "last_message_preview" TEXT,
  "last_message_outgoing" INTEGER default 0,
  "unread_count" INTEGER not null default 0,
  "status" TEXT CHECK ("status" IN ('open', 'archived')) not null default 'open',
  "social_identity_id" INTEGER REFERENCES "social_identities"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "dm_conversations_provider_remote_id_unique" ON "dm_conversations" ("provider", "remote_id");
CREATE INDEX IF NOT EXISTS "dm_conversations_status_last_message_at_index" ON "dm_conversations" ("status", "last_message_at");
CREATE UNIQUE INDEX IF NOT EXISTS "dm_conversations_uuid_unique" ON "dm_conversations" ("uuid");
