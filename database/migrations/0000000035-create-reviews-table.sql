CREATE TABLE IF NOT EXISTS "reviews" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "rating" INTEGER not null,
  "title" TEXT not null,
  "content" TEXT not null,
  "is_verified_purchase" INTEGER,
  "is_approved" INTEGER,
  "is_featured" INTEGER,
  "helpful_votes" INTEGER default 0,
  "unhelpful_votes" INTEGER default 0,
  "purchase_date" TEXT,
  "images" TEXT,
  "product_id" INTEGER REFERENCES "products"("id"),
  "customer_id" INTEGER REFERENCES "customers"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "reviews_reviews_uuid_unique" ON "reviews" ("uuid");
