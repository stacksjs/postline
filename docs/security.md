# Security and privacy

The Mac app serves its workspace on the local machine and grants access to its own window. A server install uses a single owner account. Use HTTPS and set `APP_URL` to the public address. Add a passkey or two-factor authentication under **Settings > Account**, and keep recovery codes separately. [Recover the owner account](./account-recovery.md).

Postline sends content to the networks you connect when you publish, reply, or run supported monitoring. It stores mirrored direct messages and matched mentions in the workspace database. Settings can store an AI provider key. Using that provider for campaign planning sends your brief and channel details to it. The built-in planner processes campaigns locally.

Network tokens and saved AI keys are sealed with the application's encryption key. The database also contains post and message content. Restrict access to the data directory, exports, logs, and recovery artifacts. Keep the encryption key with your recovery materials and protect the off-site recovery key separately. [Back up and restore a server](./recovery.md).

If you suspect a provider key was exposed, revoke it with the provider and reconnect that account or replace the key in Settings. For a vulnerability in Postline, use GitHub's private reporting channel if enabled or contact a maintainer privately. Remove credentials and private content from diagnostic samples.
