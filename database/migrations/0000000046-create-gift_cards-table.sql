CREATE TABLE IF NOT EXISTS "gift_cards" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "code" TEXT not null,
  "initial_balance" INTEGER not null,
  "current_balance" INTEGER not null,
  "currency" TEXT,
  "status" TEXT not null,
  "purchaser_id" TEXT,
  "recipient_email" TEXT,
  "recipient_name" TEXT,
  "personal_message" TEXT,
  "is_digital" INTEGER,
  "is_reloadable" INTEGER,
  "is_active" INTEGER default 1,
  "expiry_date" TEXT,
  "last_used_date" TEXT,
  "template_id" TEXT,
  "customer_id" INTEGER REFERENCES "customers"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "gift_cards_gift_cards_code_unique" ON "gift_cards" ("code");
CREATE UNIQUE INDEX IF NOT EXISTS "gift_cards_gift_cards_uuid_unique" ON "gift_cards" ("uuid");
