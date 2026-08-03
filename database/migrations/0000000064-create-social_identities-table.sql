CREATE TABLE IF NOT EXISTS "social_identities" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "handle" TEXT not null,
  "display_name" TEXT,
  "provider" TEXT CHECK ("provider" IN ('bluesky', 'twitter', 'mastodon', 'facebook', 'instagram', 'tiktok', 'linkedin', 'threads')) not null default 'bluesky',
  "external_id" TEXT,
  "auth_status" TEXT CHECK ("auth_status" IN ('connected', 'expired', 'revoked', 'missing')) not null default 'connected',
  "access_token" TEXT,
  "refresh_token" TEXT,
  "token_expires_at" TEXT,
  "account_id" INTEGER REFERENCES "accounts"("id"),
  "social_driver_id" INTEGER REFERENCES "social_drivers"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "social_identities_uuid_unique" ON "social_identities" ("uuid");
