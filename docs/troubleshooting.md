# Troubleshooting

| What you see | What to check |
|---|---|
| Sign-in returns to the login screen | Check that the browser uses HTTPS and that `APP_URL` names the address you opened. [Configure HTTPS](./self-hosting.md). |
| A passkey is refused | Compare the browser's origin to `PASSKEY_ORIGIN` or `APP_URL`. Keep HTTPS enabled on a remote server. |
| You lost the password or authenticator | Use `./buddy user:add <email> --update` on the server. [Recover the owner account](./first-run.md#if-you-lose-the-password). |
| A scheduled post did not go out | Check that the Mac app or server scheduler is running, scheduled publishing is resumed, and the workspace time zone is correct. Check **Queue > Needs attention** for the account-specific result. [Scheduling](./planning.md). |
| An account will not connect | Compare the callback address and required scopes in the provider's console. Check the connected account's role when publishing for a company or Page. [Network setup](./networks/index.md). |
| Instagram cannot fetch an image | Check that the image URL is reachable by Instagram over HTTPS. Loopback and private addresses are accessible only from your own network. [Instagram images](./networks/instagram.md). |
| The Inbox or Listening looks empty | Confirm a supported account or rule is active. Run a manual sync or scan and check for provider errors. [Monitoring](./monitoring.md). |
| The Mac app could not upgrade its workspace | Keep the data folder and the pre-migration database copy named in the error. [Upgrading](./upgrading.md). |

For Mac logs, open **Settings > General > Troubleshooting > Show in Finder**. You can also open `~/Library/Logs/Postline.log` directly. On a server, check the web, API, and scheduler service logs for the same time window. Include your Postline version and the failing step when reporting a problem, with account credentials and private content removed.
