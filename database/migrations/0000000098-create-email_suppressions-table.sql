-- The suppression list @stacksjs/email expects but no migration created.
--
-- Without this table every send logs
--   [email/suppression] email_suppressions table missing - suppression checks
--   accepted but NOT enforced. Run migrations to enable enforcement.
-- and `isSuppressed()` returns false for everyone, so a bounced, complained-at
-- or unsubscribed address keeps receiving mail. The framework degrades rather
-- than throwing, which is why nothing surfaced it until a newsletter was
-- actually delivered.
--
-- Columns match what suppression.js reads and writes: a canonicalised
-- lowercase `email`, a `type` of bounce | complaint | unsubscribe | manual, a
-- nullable `reason`, and `created_at` written as "YYYY-MM-DD HH:MM:SS".
CREATE TABLE IF NOT EXISTS "email_suppressions" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "email" TEXT not null,
  "type" TEXT CHECK ("type" IN ('bounce', 'complaint', 'unsubscribe', 'manual')) not null,
  "reason" TEXT,
  "created_at" TEXT not null default CURRENT_TIMESTAMP
);

-- suppress() catches a UNIQUE violation and treats it as already-suppressed,
-- so the constraint is load-bearing: without it the same address accumulates a
-- row per bounce.
CREATE UNIQUE INDEX IF NOT EXISTS "email_suppressions_email_type_unique" ON "email_suppressions" ("email", "type");

-- isSuppressed() filters on email, and optionally narrows by type.
CREATE INDEX IF NOT EXISTS "email_suppressions_email_index" ON "email_suppressions" ("email");
