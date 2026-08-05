CREATE TABLE IF NOT EXISTS "publication_subscribers" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "email" TEXT not null,
  "name" TEXT,
  "status" TEXT CHECK ("status" IN ('pending', 'active', 'unsubscribed', 'bounced')) not null default 'pending',
  "plan" TEXT CHECK ("plan" IN ('free', 'paid')) not null default 'free',
  "stripe_customer_id" TEXT,
  "stripe_subscription_id" TEXT,
  "current_period_end" TEXT,
  "cancels_at" TEXT,
  "confirmation_token" TEXT,
  "unsubscribe_token" TEXT not null,
  "confirmed_at" TEXT,
  "source" TEXT CHECK ("source" IN ('site', 'discover', 'import', 'api')) not null default 'site',
  "source_entry_id" INTEGER,
  "publication_id" INTEGER REFERENCES "publications"("id"),
  "publication_tier_id" INTEGER REFERENCES "publication_tiers"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "publication_subscribers_email_unique" ON "publication_subscribers" ("publication_id", "email");
CREATE INDEX IF NOT EXISTS "publication_subscribers_status_plan_index" ON "publication_subscribers" ("status", "plan");
CREATE UNIQUE INDEX IF NOT EXISTS "publication_subscribers_unsubscribe_token_unique" ON "publication_subscribers" ("unsubscribe_token");
CREATE UNIQUE INDEX IF NOT EXISTS "publication_subscribers_uuid_unique" ON "publication_subscribers" ("uuid");
