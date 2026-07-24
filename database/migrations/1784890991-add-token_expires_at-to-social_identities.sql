-- Track OAuth access-token expiry so LinkedIn / Threads / Instagram tokens can
-- be proactively refreshed (or exchanged for long-lived ones) before they
-- lapse, instead of only failing at publish time. NULL means "no known expiry"
-- (e.g. Bluesky app passwords, Mastodon tokens, env-configured tokens).
ALTER TABLE "social_identities" ADD COLUMN "token_expires_at" TEXT;
