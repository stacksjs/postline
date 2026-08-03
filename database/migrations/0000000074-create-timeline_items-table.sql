CREATE TABLE IF NOT EXISTS "timeline_items" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "provider" TEXT CHECK ("provider" IN ('bluesky', 'twitter', 'mastodon', 'facebook', 'instagram', 'tiktok', 'linkedin', 'threads')) not null default 'bluesky',
  "remote_uri" TEXT not null,
  "author_handle" TEXT not null,
  "author_name" TEXT,
  "body" TEXT not null,
  "posted_at" TEXT not null,
  "like_count" INTEGER default 0,
  "repost_count" INTEGER default 0,
  "reply_count" INTEGER default 0,
  "social_driver_id" INTEGER REFERENCES "social_drivers"("id"),
  "social_identity_id" INTEGER REFERENCES "social_identities"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE INDEX IF NOT EXISTS "timeline_items_provider_posted_at_index" ON "timeline_items" ("provider", "posted_at");
CREATE UNIQUE INDEX IF NOT EXISTS "timeline_items_remote_uri_unique" ON "timeline_items" ("remote_uri");
CREATE UNIQUE INDEX IF NOT EXISTS "timeline_items_uuid_unique" ON "timeline_items" ("uuid");
