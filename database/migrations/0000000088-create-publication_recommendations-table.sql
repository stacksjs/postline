CREATE TABLE IF NOT EXISTS "publication_recommendations" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "target_slug" TEXT not null,
  "target_name" TEXT not null,
  "note" TEXT,
  "target_publication_id" INTEGER,
  "publication_id" INTEGER REFERENCES "publications"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "publication_recommendations_edge_unique" ON "publication_recommendations" ("publication_id", "target_slug");
CREATE UNIQUE INDEX IF NOT EXISTS "publication_recommendations_uuid_unique" ON "publication_recommendations" ("uuid");
