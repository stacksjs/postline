CREATE TABLE IF NOT EXISTS "post_comments" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "source_key" TEXT not null,
  "parent_id" INTEGER,
  "author_name" TEXT not null,
  "author_email" TEXT not null,
  "body" TEXT not null,
  "status" TEXT CHECK ("status" IN ('visible', 'pending', 'spam', 'removed')) not null default 'visible',
  "publication_id" INTEGER REFERENCES "publications"("id"),
  "publication_subscriber_id" INTEGER REFERENCES "publication_subscribers"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE INDEX IF NOT EXISTS "post_comments_target_status_index" ON "post_comments" ("source_key", "status", "created_at");
CREATE INDEX IF NOT EXISTS "post_comments_parent_index" ON "post_comments" ("parent_id");
CREATE UNIQUE INDEX IF NOT EXISTS "post_comments_uuid_unique" ON "post_comments" ("uuid");
