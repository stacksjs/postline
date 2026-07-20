-- The 0.70.145 useAuth trait expects two-factor columns on users that the
-- original users migration (written against 0.70.40) predates. LoginAction
-- selects them, so they must exist even though 2FA is unused here.
ALTER TABLE "users" ADD COLUMN "two_factor_secret" TEXT;
ALTER TABLE "users" ADD COLUMN "two_factor_enabled" INTEGER DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "two_factor_challenges" TEXT;
ALTER TABLE "users" ADD COLUMN "two_factor_pending_secrets" TEXT;
ALTER TABLE "users" ADD COLUMN "two_factor_last_used_step" INTEGER;
