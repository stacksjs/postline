CREATE TABLE IF NOT EXISTS "discover_entries" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "form" TEXT CHECK ("form" IN ('short', 'long')) not null,
  "source_key" TEXT not null,
  "title" TEXT,
  "body" TEXT not null,
  "url" TEXT,
  "status" TEXT CHECK ("status" IN ('visible', 'hidden', 'removed')) not null default 'visible',
  "published_at" TEXT not null,
  "score" INTEGER not null default 0,
  "read_count" INTEGER not null default 0,
  "conversion_count" INTEGER not null default 0,
  "publication_id" INTEGER REFERENCES "publications"("id"),
  "post_id" INTEGER REFERENCES "posts"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE INDEX IF NOT EXISTS "discover_entries_form_published_at_index" ON "discover_entries" ("form", "published_at");
CREATE UNIQUE INDEX IF NOT EXISTS "discover_entries_publication_source_unique" ON "discover_entries" ("publication_id", "form", "source_key");
CREATE INDEX IF NOT EXISTS "discover_entries_status_score_index" ON "discover_entries" ("status", "score");
CREATE UNIQUE INDEX IF NOT EXISTS "discover_entries_uuid_unique" ON "discover_entries" ("uuid");
