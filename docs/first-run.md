# First run

## The one account

A Postline install has a single owner.

- **In the Mac app** there is no sign-in at all: the app only answers its own
  window.
- **On a server** open `/setup` to create the owner account before you share
  the address. Registration closes as soon as that account exists. Setup then
  asks for the workspace name, time zone, and first publishing channel.

Signing in afterwards takes the password, or a passkey added under
**Settings > Account**. Two-factor sign-in with an authenticator app, and its
recovery codes, are there too.

## If you lose the password

A passkey you added still works. To reset the password or recover from losing
your authenticator and recovery codes, follow the [owner account recovery guide](./account-recovery.md).

## Your first post

1. Connect a network in setup or under **Settings > Channels**. You can also
   start with the built-in Blog. See [Connecting networks](./networks/index.md).
2. Write in the composer, pick the accounts, and **Publish**, or schedule it
   for later. Each network shows how many characters it allows.
3. The Queue lists scheduled posts and what happened to each. Failures name
   the network and its reason; rate limits and short outages are retried by
   themselves.

The Mac app, Docker image, and `./buddy dev` start the scheduler. If you run
Postline from source in production, run `./buddy schedule:run` beside the app.
The Queue page says when the scheduler has stopped.
