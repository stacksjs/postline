CREATE TABLE IF NOT EXISTS "media_assets" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "type" TEXT CHECK ("type" IN ('image', 'video', 'link')) not null default 'image',
  "url" TEXT not null,
  "alt_text" TEXT,
  "mime_type" TEXT,
  "byte_size" INTEGER default 0,
  "post_id" INTEGER REFERENCES "posts"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "media_assets_media_assets_uuid_unique" ON "media_assets" ("uuid");
