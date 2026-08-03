CREATE TABLE IF NOT EXISTS "campaign_posts" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "title" TEXT not null,
  "body" TEXT not null,
  "providers" TEXT not null,
  "pillar" TEXT CHECK ("pillar" IN ('teaser', 'story', 'education', 'proof', 'launch', 'follow-up')) not null default 'story',
  "status" TEXT CHECK ("status" IN ('idea', 'ready', 'queued', 'published', 'skipped')) not null default 'idea',
  "scheduled_at" TEXT not null,
  "position" INTEGER not null default 0,
  "launch_campaign_id" INTEGER REFERENCES "launch_campaigns"("id"),
  "post_id" INTEGER REFERENCES "posts"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE INDEX IF NOT EXISTS "campaign_posts_campaign_posts_campaign_scheduled_at_index" ON "campaign_posts" ("launch_campaign_id", "scheduled_at");
CREATE INDEX IF NOT EXISTS "campaign_posts_campaign_posts_status_index" ON "campaign_posts" ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_posts_campaign_posts_uuid_unique" ON "campaign_posts" ("uuid");
