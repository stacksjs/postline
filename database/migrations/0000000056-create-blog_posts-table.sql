CREATE TABLE IF NOT EXISTS "blog_posts" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "title" TEXT not null,
  "slug" TEXT not null,
  "body" TEXT not null,
  "excerpt" TEXT,
  "status" TEXT CHECK ("status" IN ('draft', 'published', 'archived')) not null default 'draft',
  "published_at" TEXT,
  "post_id" INTEGER REFERENCES "posts"("id"),
  "account_id" INTEGER REFERENCES "accounts"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE INDEX IF NOT EXISTS "blog_posts_blog_posts_status_published_at_index" ON "blog_posts" ("status", "published_at");
CREATE UNIQUE INDEX IF NOT EXISTS "blog_posts_blog_posts_slug_unique" ON "blog_posts" ("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "blog_posts_blog_posts_uuid_unique" ON "blog_posts" ("uuid");
