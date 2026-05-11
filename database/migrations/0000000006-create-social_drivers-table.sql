CREATE TABLE IF NOT EXISTS "social_drivers" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "provider" TEXT CHECK ("provider" IN ('bluesky', 'twitter', 'mastodon', 'facebook', 'instagram', 'tiktok', 'linkedin')),
  "display_name" TEXT,
  "status" TEXT CHECK ("status" IN ('active', 'planned', 'disabled')) default 'planned',
  "character_limit" INTEGER default 300,
  "capabilities" TEXT,
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);