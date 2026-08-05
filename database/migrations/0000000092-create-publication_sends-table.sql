CREATE TABLE IF NOT EXISTS "publication_sends" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "source_key" TEXT not null,
  "subject" TEXT not null,
  "body" TEXT not null,
  "url" TEXT,
  "audience" TEXT CHECK ("audience" IN ('everyone', 'paid')) not null default 'everyone',
  "status" TEXT CHECK ("status" IN ('queued', 'sending', 'sent', 'failed')) not null default 'queued',
  "recipient_count" INTEGER not null default 0,
  "delivered_count" INTEGER not null default 0,
  "failed_count" INTEGER not null default 0,
  "last_error" TEXT,
  "sent_at" TEXT,
  "publication_id" INTEGER REFERENCES "publications"("id"),
  "post_id" INTEGER REFERENCES "posts"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE INDEX IF NOT EXISTS "publication_sends_status_created_index" ON "publication_sends" ("status", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "publication_sends_source_unique" ON "publication_sends" ("publication_id", "source_key");
CREATE UNIQUE INDEX IF NOT EXISTS "publication_sends_uuid_unique" ON "publication_sends" ("uuid");
