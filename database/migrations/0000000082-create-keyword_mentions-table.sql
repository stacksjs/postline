CREATE TABLE IF NOT EXISTS "keyword_mentions" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "provider" TEXT CHECK ("provider" IN ('bluesky', 'twitter', 'mastodon')) not null,
  "remote_uri" TEXT not null,
  "url" TEXT not null,
  "author_handle" TEXT not null,
  "author_name" TEXT,
  "body" TEXT not null,
  "matched_keywords" TEXT not null,
  "status" TEXT CHECK ("status" IN ('unread', 'read')) not null default 'unread',
  "posted_at" TEXT not null,
  "keyword_monitor_id" INTEGER REFERENCES "keyword_monitors"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "keyword_mentions_monitor_provider_uri_unique" ON "keyword_mentions" ("keyword_monitor_id", "provider", "remote_uri");
CREATE INDEX IF NOT EXISTS "keyword_mentions_status_posted_at_index" ON "keyword_mentions" ("status", "posted_at");
CREATE UNIQUE INDEX IF NOT EXISTS "keyword_mentions_uuid_unique" ON "keyword_mentions" ("uuid");
