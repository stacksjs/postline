CREATE TABLE IF NOT EXISTS "accounts" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT not null,
  "workspace_name" TEXT not null,
  "timezone" TEXT not null default 'America/Los_Angeles',
  "default_audience" TEXT CHECK ("default_audience" IN ('public', 'followers', 'private')) not null default 'public',
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "accounts_uuid_unique" ON "accounts" ("uuid");
