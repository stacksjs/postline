CREATE TABLE IF NOT EXISTS "keyword_monitors" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT not null,
  "keywords" TEXT not null,
  "providers" TEXT not null,
  "match_mode" TEXT CHECK ("match_mode" IN ('any', 'all', 'phrase')) not null default 'any',
  "status" TEXT CHECK ("status" IN ('active', 'paused')) not null default 'active',
  "last_checked_at" TEXT,
  "last_error" TEXT,
  "account_id" INTEGER REFERENCES "accounts"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE INDEX IF NOT EXISTS "keyword_monitors_status_last_checked_at_index" ON "keyword_monitors" ("status", "last_checked_at");
CREATE UNIQUE INDEX IF NOT EXISTS "keyword_monitors_uuid_unique" ON "keyword_monitors" ("uuid");
