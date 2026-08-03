CREATE TABLE IF NOT EXISTS "purge_runs" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "provider" TEXT CHECK ("provider" IN ('bluesky', 'twitter', 'mastodon', 'facebook', 'instagram', 'tiktok', 'linkedin', 'threads', 'blog')) not null,
  "handle" TEXT,
  "scope" TEXT CHECK ("scope" IN ('tracked', 'all')) not null default 'tracked',
  "mode" TEXT CHECK ("mode" IN ('preview', 'execute')) not null default 'preview',
  "status" TEXT CHECK ("status" IN ('previewed', 'completed', 'partial', 'failed', 'skipped')) not null default 'previewed',
  "matched_count" INTEGER default 0,
  "deleted_count" INTEGER default 0,
  "failed_count" INTEGER default 0,
  "details" TEXT,
  "failure_reason" TEXT,
  "finished_at" TEXT,
  "account_id" INTEGER REFERENCES "accounts"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE INDEX IF NOT EXISTS "purge_runs_provider_created_at_index" ON "purge_runs" ("provider", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "purge_runs_uuid_unique" ON "purge_runs" ("uuid");
