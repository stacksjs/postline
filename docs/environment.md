# Environment reference

For a server install, start with `.env.example` in the project root and keep the resulting `.env` private. The Mac app sets up its own database and encryption key. Use Settings to configure it.

| Setting | Purpose |
|---|---|
| `APP_ENV` | Set `production` for a deployed server. |
| `APP_URL` | Public address used for links, network callbacks and session cookies. Use HTTPS beyond loopback. |
| `APP_KEY` | Encrypts stored credentials. Keep a copy with recoverable data and reuse the key when migrating an existing workspace. |
| `PASSKEY_ORIGIN` | Optional origin override when browsers reach the app at a different origin. Include the scheme. |
| `DB_CONNECTION`, `DB_DATABASE_PATH` | Set the connection to `sqlite` and point the web, API, and scheduler at the same database. Use a persistent directory outside deploy releases. |
| `POSTLINE_MEDIA_DIR` | Persistent image directory shared by the API and scheduler. |
| `POSTLINE_LATE_GRACE_MINUTES` | Minutes the scheduler still sends an overdue post after resuming. The default is `30`. |
| `POSTLINE_BACKUP_BUCKET`, `POSTLINE_BACKUP_REGION` | Private off-site S3 destination for server recovery sets. |
| `POSTLINE_BACKUP_ACCESS_KEY_ID`, `POSTLINE_BACKUP_SECRET_ACCESS_KEY` | Scoped credentials for the backup scheduler. |
| `POSTLINE_BACKUP_RECOVERY_KEY` | Separate secret for encrypting the recovery set. Store a recoverable copy outside the host. |
| `POSTLINE_UPDATES_BUCKET`, `POSTLINE_UPDATES_REGION` | Private S3 storage used by the Postline desktop update feed. |
| `POSTLINE_UPDATES_ACCESS_KEY_ID`, `POSTLINE_UPDATES_SECRET_ACCESS_KEY` | Read credentials for the feed server. The release runner uses a separate publishing credential. |
| `MAIL_MAILER` and `MAIL_*` | Mail transport and sender configuration for email delivery. |
| `POSTLINE_ALERT_EMAIL`, `POSTLINE_ALERT_WEBHOOK_URL` | Where to send publishing or account alerts. |
| `POSTLINE_ERROR_WEBHOOK_URL` | Optional destination for aggregated server error alerts. |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `OLLAMA_HOST`, `OLLAMA_MODEL` | Campaign AI defaults. Saved AI settings take precedence. |

The network-specific guides list each callback and credential. The annotated [`.env.example`](https://github.com/stacksjs/postline/blob/main/.env.example) supplies the full framework and application template. [Connect a network](./networks/index.md). [Back up and restore](./recovery.md).
