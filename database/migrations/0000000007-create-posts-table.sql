CREATE TABLE IF NOT EXISTS "posts" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "title" TEXT,
  "body" TEXT,
  "status" TEXT CHECK ("status" IN ('draft', 'scheduled', 'publishing', 'published', 'failed', 'archived')) default 'draft',
  "scheduled_at" TEXT,
  "published_at" TEXT,
  "timezone" TEXT default 'America/Los_Angeles',
  "thread_key" TEXT,
  "source" TEXT CHECK ("source" IN ('composer', 'import', 'api')) default 'composer',
  "notes" TEXT,
  "account_id" INTEGER,
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);