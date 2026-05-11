CREATE TABLE IF NOT EXISTS "media_assets" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "type" TEXT CHECK ("type" IN ('image', 'video', 'link')) default 'image',
  "url" TEXT,
  "alt_text" TEXT,
  "mime_type" TEXT,
  "byte_size" INTEGER default 0,
  "post_id" INTEGER,
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);