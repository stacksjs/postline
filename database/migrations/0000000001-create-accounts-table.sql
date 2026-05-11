CREATE TABLE IF NOT EXISTS "accounts" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT,
  "workspace_name" TEXT,
  "timezone" TEXT default 'America/Los_Angeles',
  "default_audience" TEXT CHECK ("default_audience" IN ('public', 'followers', 'private')) default 'public',
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);