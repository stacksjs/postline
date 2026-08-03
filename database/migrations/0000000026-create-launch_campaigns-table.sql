CREATE TABLE IF NOT EXISTS "launch_campaigns" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT not null,
  "objective" TEXT,
  "audience" TEXT,
  "tone" TEXT CHECK ("tone" IN ('clear', 'bold', 'warm', 'technical', 'playful')) not null default 'clear',
  "status" TEXT CHECK ("status" IN ('draft', 'active', 'paused', 'completed', 'archived')) not null default 'draft',
  "start_date" TEXT not null,
  "end_date" TEXT not null,
  "timezone" TEXT not null default 'America/Los_Angeles',
  "account_id" INTEGER REFERENCES "accounts"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE INDEX IF NOT EXISTS "launch_campaigns_launch_campaigns_status_start_date_index" ON "launch_campaigns" ("status", "start_date");
CREATE UNIQUE INDEX IF NOT EXISTS "launch_campaigns_launch_campaigns_uuid_unique" ON "launch_campaigns" ("uuid");
