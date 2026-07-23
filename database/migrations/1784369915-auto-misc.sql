PRAGMA foreign_keys=OFF;
BEGIN;
CREATE TABLE "_qb_tmp_accounts" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT not null,
  "workspace_name" TEXT not null,
  "timezone" TEXT not null default 'America/Los_Angeles',
  "default_audience" TEXT CHECK ("default_audience" IN ('public', 'followers', 'private')) not null default 'public',
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
INSERT INTO "_qb_tmp_accounts" ("id", "name", "workspace_name", "timezone", "default_audience", "created_at", "updated_at", "uuid") SELECT "id", "name", "workspace_name", "timezone", "default_audience", "created_at", "updated_at", "uuid" FROM "accounts";
DROP TABLE "accounts";
ALTER TABLE "_qb_tmp_accounts" RENAME TO "accounts";
CREATE UNIQUE INDEX IF NOT EXISTS "accounts_accounts_uuid_unique" ON "accounts" ("uuid");
PRAGMA foreign_key_check;
COMMIT;
PRAGMA foreign_keys=ON;
PRAGMA foreign_keys=OFF;
BEGIN;
CREATE TABLE "_qb_tmp_post_targets" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "provider" TEXT CHECK ("provider" IN ('bluesky', 'twitter', 'mastodon', 'facebook', 'instagram', 'tiktok', 'linkedin', 'threads', 'blog')) not null,
  "status" TEXT CHECK ("status" IN ('draft', 'scheduled', 'publishing', 'published', 'failed', 'skipped')) not null default 'draft',
  "scheduled_at" TEXT,
  "remote_uri" TEXT,
  "remote_cid" TEXT,
  "failure_reason" TEXT,
  "metrics" TEXT,
  "post_id" INTEGER REFERENCES "posts"("id"),
  "social_driver_id" INTEGER REFERENCES "social_drivers"("id"),
  "social_identity_id" INTEGER REFERENCES "social_identities"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
INSERT INTO "_qb_tmp_post_targets" ("id", "provider", "status", "scheduled_at", "remote_uri", "remote_cid", "failure_reason", "metrics", "post_id", "social_driver_id", "social_identity_id", "created_at", "updated_at", "uuid") SELECT "id", "provider", "status", "scheduled_at", "remote_uri", "remote_cid", "failure_reason", "metrics", "post_id", "social_driver_id", "social_identity_id", "created_at", "updated_at", "uuid" FROM "post_targets";
DROP TABLE "post_targets";
ALTER TABLE "_qb_tmp_post_targets" RENAME TO "post_targets";
CREATE INDEX IF NOT EXISTS "post_targets_post_targets_provider_status_index" ON "post_targets" ("provider", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "post_targets_post_targets_uuid_unique" ON "post_targets" ("uuid");
PRAGMA foreign_key_check;
COMMIT;
PRAGMA foreign_keys=ON;
PRAGMA foreign_keys=OFF;
BEGIN;
CREATE TABLE "_qb_tmp_social_identities" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "handle" TEXT not null,
  "display_name" TEXT,
  "provider" TEXT CHECK ("provider" IN ('bluesky', 'twitter', 'mastodon', 'facebook', 'instagram', 'tiktok', 'linkedin')) not null default 'bluesky',
  "external_id" TEXT,
  "auth_status" TEXT CHECK ("auth_status" IN ('connected', 'expired', 'revoked', 'missing')) not null default 'connected',
  "access_token" TEXT,
  "refresh_token" TEXT,
  "account_id" INTEGER REFERENCES "accounts"("id"),
  "social_driver_id" INTEGER REFERENCES "social_drivers"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
INSERT INTO "_qb_tmp_social_identities" ("id", "handle", "display_name", "provider", "external_id", "auth_status", "access_token", "refresh_token", "account_id", "social_driver_id", "created_at", "updated_at", "uuid") SELECT "id", "handle", "display_name", "provider", "external_id", "auth_status", "access_token", "refresh_token", "account_id", "social_driver_id", "created_at", "updated_at", "uuid" FROM "social_identities";
DROP TABLE "social_identities";
ALTER TABLE "_qb_tmp_social_identities" RENAME TO "social_identities";
CREATE UNIQUE INDEX IF NOT EXISTS "social_identities_social_identities_uuid_unique" ON "social_identities" ("uuid");
PRAGMA foreign_key_check;
COMMIT;
PRAGMA foreign_keys=ON;
PRAGMA foreign_keys=OFF;
BEGIN;
CREATE TABLE "_qb_tmp_media_assets" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "type" TEXT CHECK ("type" IN ('image', 'video', 'link')) not null default 'image',
  "url" TEXT not null,
  "alt_text" TEXT,
  "mime_type" TEXT,
  "byte_size" INTEGER default 0,
  "post_id" INTEGER REFERENCES "posts"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
INSERT INTO "_qb_tmp_media_assets" ("id", "type", "url", "alt_text", "mime_type", "byte_size", "post_id", "created_at", "updated_at", "uuid") SELECT "id", "type", "url", "alt_text", "mime_type", "byte_size", "post_id", "created_at", "updated_at", "uuid" FROM "media_assets";
DROP TABLE "media_assets";
ALTER TABLE "_qb_tmp_media_assets" RENAME TO "media_assets";
CREATE UNIQUE INDEX IF NOT EXISTS "media_assets_media_assets_uuid_unique" ON "media_assets" ("uuid");
PRAGMA foreign_key_check;
COMMIT;
PRAGMA foreign_keys=ON;
PRAGMA foreign_keys=OFF;
BEGIN;
CREATE TABLE "_qb_tmp_timeline_items" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "provider" TEXT CHECK ("provider" IN ('bluesky', 'twitter', 'mastodon', 'facebook', 'instagram', 'tiktok', 'linkedin')) not null default 'bluesky',
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
INSERT INTO "_qb_tmp_timeline_items" ("id", "provider", "remote_uri", "author_handle", "author_name", "body", "posted_at", "like_count", "repost_count", "reply_count", "social_driver_id", "social_identity_id", "created_at", "updated_at", "uuid") SELECT "id", "provider", "remote_uri", "author_handle", "author_name", "body", "posted_at", "like_count", "repost_count", "reply_count", "social_driver_id", "social_identity_id", "created_at", "updated_at", "uuid" FROM "timeline_items";
DROP TABLE "timeline_items";
ALTER TABLE "_qb_tmp_timeline_items" RENAME TO "timeline_items";
CREATE INDEX IF NOT EXISTS "timeline_items_timeline_items_provider_posted_at_index" ON "timeline_items" ("provider", "posted_at");
CREATE UNIQUE INDEX IF NOT EXISTS "timeline_items_timeline_items_remote_uri_unique" ON "timeline_items" ("remote_uri");
CREATE UNIQUE INDEX IF NOT EXISTS "timeline_items_timeline_items_uuid_unique" ON "timeline_items" ("uuid");
PRAGMA foreign_key_check;
COMMIT;
PRAGMA foreign_keys=ON;
PRAGMA foreign_keys=OFF;
BEGIN;
CREATE TABLE "_qb_tmp_blog_posts" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "title" TEXT not null,
  "slug" TEXT not null,
  "body" TEXT not null,
  "excerpt" TEXT,
  "status" TEXT CHECK ("status" IN ('draft', 'published', 'archived')) not null default 'draft',
  "published_at" TEXT,
  "post_id" INTEGER REFERENCES "posts"("id"),
  "account_id" INTEGER REFERENCES "accounts"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
INSERT INTO "_qb_tmp_blog_posts" ("id", "title", "slug", "body", "excerpt", "status", "published_at", "post_id", "account_id", "created_at", "updated_at", "uuid") SELECT "id", "title", "slug", "body", "excerpt", "status", "published_at", "post_id", "account_id", "created_at", "updated_at", "uuid" FROM "blog_posts";
DROP TABLE "blog_posts";
ALTER TABLE "_qb_tmp_blog_posts" RENAME TO "blog_posts";
CREATE INDEX IF NOT EXISTS "blog_posts_blog_posts_status_published_at_index" ON "blog_posts" ("status", "published_at");
CREATE UNIQUE INDEX IF NOT EXISTS "blog_posts_blog_posts_slug_unique" ON "blog_posts" ("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "blog_posts_blog_posts_uuid_unique" ON "blog_posts" ("uuid");
PRAGMA foreign_key_check;
COMMIT;
PRAGMA foreign_keys=ON;
PRAGMA foreign_keys=OFF;
BEGIN;
CREATE TABLE "_qb_tmp_social_drivers" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "provider" TEXT CHECK ("provider" IN ('bluesky', 'twitter', 'mastodon', 'facebook', 'instagram', 'tiktok', 'linkedin')) not null,
  "display_name" TEXT not null,
  "status" TEXT CHECK ("status" IN ('active', 'planned', 'disabled')) not null default 'planned',
  "character_limit" INTEGER not null default 300,
  "capabilities" TEXT,
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
INSERT INTO "_qb_tmp_social_drivers" ("id", "provider", "display_name", "status", "character_limit", "capabilities", "created_at", "updated_at", "uuid") SELECT "id", "provider", "display_name", "status", "character_limit", "capabilities", "created_at", "updated_at", "uuid" FROM "social_drivers";
DROP TABLE "social_drivers";
ALTER TABLE "_qb_tmp_social_drivers" RENAME TO "social_drivers";
CREATE UNIQUE INDEX IF NOT EXISTS "social_drivers_social_drivers_provider_unique" ON "social_drivers" ("provider");
CREATE UNIQUE INDEX IF NOT EXISTS "social_drivers_social_drivers_uuid_unique" ON "social_drivers" ("uuid");
PRAGMA foreign_key_check;
COMMIT;
PRAGMA foreign_keys=ON;
PRAGMA foreign_keys=OFF;
BEGIN;
CREATE TABLE "_qb_tmp_posts" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "title" TEXT,
  "body" TEXT not null,
  "status" TEXT CHECK ("status" IN ('draft', 'scheduled', 'publishing', 'published', 'failed', 'archived')) not null default 'draft',
  "scheduled_at" TEXT,
  "published_at" TEXT,
  "timezone" TEXT not null default 'America/Los_Angeles',
  "thread_key" TEXT,
  "source" TEXT CHECK ("source" IN ('composer', 'import', 'api')) not null default 'composer',
  "notes" TEXT,
  "account_id" INTEGER REFERENCES "accounts"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
INSERT INTO "_qb_tmp_posts" ("id", "title", "body", "status", "scheduled_at", "published_at", "timezone", "thread_key", "source", "notes", "account_id", "created_at", "updated_at", "uuid") SELECT "id", "title", "body", "status", "scheduled_at", "published_at", "timezone", "thread_key", "source", "notes", "account_id", "created_at", "updated_at", "uuid" FROM "posts";
DROP TABLE "posts";
ALTER TABLE "_qb_tmp_posts" RENAME TO "posts";
CREATE INDEX IF NOT EXISTS "posts_posts_status_scheduled_at_index" ON "posts" ("status", "scheduled_at");
CREATE UNIQUE INDEX IF NOT EXISTS "posts_posts_uuid_unique" ON "posts" ("uuid");
PRAGMA foreign_key_check;
COMMIT;
PRAGMA foreign_keys=ON;
