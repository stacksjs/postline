CREATE TABLE IF NOT EXISTS "orders" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "status" TEXT not null,
  "total_amount" INTEGER not null,
  "tax_amount" INTEGER,
  "discount_amount" INTEGER,
  "delivery_fee" INTEGER,
  "tip_amount" INTEGER,
  "order_type" TEXT not null,
  "delivery_address" TEXT,
  "special_instructions" TEXT,
  "estimated_delivery_time" TEXT,
  "applied_coupon_id" TEXT,
  "customer_id" INTEGER REFERENCES "customers"("id"),
  "coupon_id" INTEGER REFERENCES "coupons"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "orders_orders_uuid_unique" ON "orders" ("uuid");
