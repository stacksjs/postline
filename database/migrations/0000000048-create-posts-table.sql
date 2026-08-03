CREATE TABLE IF NOT EXISTS "posts" (
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
CREATE INDEX IF NOT EXISTS "posts_status_scheduled_at_index" ON "posts" ("status", "scheduled_at");
CREATE UNIQUE INDEX IF NOT EXISTS "posts_uuid_unique" ON "posts" ("uuid");
