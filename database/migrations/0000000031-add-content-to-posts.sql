-- Persisted publish content (explicit title, link card, media refs) so
-- queued posts publish with everything the composer attached, not just
-- their text.
ALTER TABLE "posts" ADD COLUMN "content" TEXT;
