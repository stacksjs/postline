CREATE TABLE IF NOT EXISTS "timeline_items" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "provider" TEXT CHECK ("provider" IN ('bluesky', 'twitter', 'mastodon', 'facebook', 'instagram', 'tiktok', 'linkedin')) default 'bluesky',
  "remote_uri" TEXT,
  "author_handle" TEXT,
  "author_name" TEXT,
  "body" TEXT,
  "posted_at" TEXT,
  "like_count" INTEGER default 0,
  "repost_count" INTEGER default 0,
  "reply_count" INTEGER default 0,
  "social_driver_id" INTEGER,
  "social_identity_id" INTEGER,
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);