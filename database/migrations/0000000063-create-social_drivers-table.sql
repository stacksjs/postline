CREATE TABLE IF NOT EXISTS "social_drivers" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "provider" TEXT CHECK ("provider" IN ('bluesky', 'twitter', 'mastodon', 'facebook', 'instagram', 'tiktok', 'linkedin', 'threads')) not null,
  "display_name" TEXT not null,
  "status" TEXT CHECK ("status" IN ('active', 'planned', 'disabled')) not null default 'planned',
  "character_limit" INTEGER not null default 300,
  "capabilities" TEXT,
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "social_drivers_provider_unique" ON "social_drivers" ("provider");
CREATE UNIQUE INDEX IF NOT EXISTS "social_drivers_uuid_unique" ON "social_drivers" ("uuid");
