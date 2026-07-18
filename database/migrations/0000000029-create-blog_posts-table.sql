CREATE TABLE IF NOT EXISTS "blog_posts" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "title" TEXT not null,
  "slug" TEXT not null UNIQUE,
  "body" TEXT not null,
  "excerpt" TEXT,
  "status" TEXT CHECK ("status" IN ('draft', 'published', 'archived')) default 'draft',
  "published_at" TEXT,
  "post_id" INTEGER,
  "account_id" INTEGER,
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE INDEX IF NOT EXISTS "blog_posts_status_published_at_index" ON "blog_posts" ("status", "published_at");
