CREATE TABLE IF NOT EXISTS "receipts" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "printer" TEXT,
  "document" TEXT not null,
  "timestamp" TEXT not null,
  "status" TEXT CHECK ("status" IN ('success', 'failed', 'warning')) not null,
  "size" INTEGER,
  "pages" INTEGER,
  "duration" INTEGER,
  "metadata" TEXT,
  "print_device_id" INTEGER REFERENCES "print_devices"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "receipts_receipts_uuid_unique" ON "receipts" ("uuid");
