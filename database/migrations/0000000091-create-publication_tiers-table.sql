CREATE TABLE IF NOT EXISTS "publication_tiers" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT not null,
  "description" TEXT,
  "amount_cents" INTEGER not null,
  "currency" TEXT not null default 'usd',
  "interval" TEXT CHECK ("interval" IN ('month', 'year')) not null default 'month',
  "stripe_product_id" TEXT,
  "stripe_price_id" TEXT,
  "active" INTEGER default 1,
  "sort_order" INTEGER not null default 0,
  "publication_id" INTEGER REFERENCES "publications"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE INDEX IF NOT EXISTS "publication_tiers_active_sort_order_index" ON "publication_tiers" ("active", "sort_order");
CREATE UNIQUE INDEX IF NOT EXISTS "publication_tiers_uuid_unique" ON "publication_tiers" ("uuid");
