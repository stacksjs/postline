CREATE TABLE IF NOT EXISTS "logs" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "timestamp" INTEGER not null,
  "type" TEXT CHECK ("type" IN ('warning', 'error', 'info', 'success')) not null,
  "source" TEXT CHECK ("source" IN ('file', 'cli', 'system')) not null,
  "message" TEXT not null,
  "project" TEXT not null,
  "stacktrace" TEXT not null,
  "file" TEXT not null,
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT
);
