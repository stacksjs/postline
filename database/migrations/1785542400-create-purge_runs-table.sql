-- Audit trail for bulk post deletions. One row per purge (preview or
-- execute) so a destructive run is always reconstructable after the fact.
CREATE TABLE IF NOT EXISTS "purge_runs" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "provider" TEXT not null CHECK ("provider" IN ('bluesky', 'twitter', 'mastodon', 'facebook', 'instagram', 'tiktok', 'linkedin', 'threads', 'blog')),
  "handle" TEXT,
  "scope" TEXT not null CHECK ("scope" IN ('tracked', 'all')) default 'tracked',
  "mode" TEXT not null CHECK ("mode" IN ('preview', 'execute')) default 'preview',
  "status" TEXT not null CHECK ("status" IN ('previewed', 'completed', 'partial', 'failed', 'skipped')) default 'previewed',
  "matched_count" INTEGER default 0,
  "deleted_count" INTEGER default 0,
  "failed_count" INTEGER default 0,
  "details" TEXT,
  "failure_reason" TEXT,
  "finished_at" TEXT,
  "account_id" INTEGER,
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE INDEX IF NOT EXISTS "purge_runs_provider_created_at_index" ON "purge_runs" ("provider", "created_at");
