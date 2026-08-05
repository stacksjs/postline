CREATE TABLE IF NOT EXISTS "publications" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT not null,
  "slug" TEXT not null,
  "tagline" TEXT,
  "description" TEXT,
  "domain" TEXT,
  "avatar_url" TEXT,
  "author_name" TEXT,
  "listed" INTEGER default 0,
  "subscriber_count" INTEGER not null default 0,
  "entry_count" INTEGER not null default 0,
  "last_published_at" TEXT,
  "account_id" INTEGER REFERENCES "accounts"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "publications_slug_unique" ON "publications" ("slug");
CREATE INDEX IF NOT EXISTS "publications_listed_subscriber_count_index" ON "publications" ("listed", "subscriber_count");
CREATE UNIQUE INDEX IF NOT EXISTS "publications_slug_unique" ON "publications" ("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "publications_uuid_unique" ON "publications" ("uuid");
