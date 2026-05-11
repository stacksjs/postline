CREATE TABLE IF NOT EXISTS "social_identities" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "handle" TEXT,
  "display_name" TEXT,
  "provider" TEXT CHECK ("provider" IN ('bluesky', 'twitter', 'mastodon', 'facebook', 'instagram', 'tiktok', 'linkedin')) default 'bluesky',
  "external_id" INTEGER,
  "auth_status" TEXT CHECK ("auth_status" IN ('connected', 'expired', 'revoked', 'missing')) default 'connected',
  "access_token" TEXT,
  "refresh_token" TEXT,
  "account_id" INTEGER,
  "social_driver_id" INTEGER,
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);