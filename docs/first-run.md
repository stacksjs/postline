# First run

## The one account

A Postline install has a single owner.

- **In the Mac app** there is no sign-in at all: the app only answers its own
  window.
- **On a server** the first person to open `/login` and choose **First run?
  Create the workspace account** becomes the owner. Registration closes as
  soon as that account exists, so create it before you share the address.

Signing in afterwards takes the password, or a passkey added under
**Settings > Account**. Two-factor sign-in with an authenticator app, and its
recovery codes, are there too.

## If you lose the password

There is no "forgot password" email. Reset it on the machine Postline runs on:

```bash
./buddy user:add you@example.com --update
```

It prints a new password once; add `--password` to choose your own. A passkey
you added still works in the meantime.

If two-factor sign-in is on and you have lost both the authenticator and the
recovery codes, add `--without-two-factor`: it also turns two-factor sign-in
off, and you can set it up again under **Settings > Account**.

```bash
./buddy user:add you@example.com --update --without-two-factor
```

## Your first post

1. Connect a network under **Settings > Channels**. Bluesky and Mastodon take
   a minute; see [Connecting networks](./networks/index.md).
2. Write in the composer, pick the accounts, and **Publish**, or schedule it
   for later. Each network shows how many characters it allows.
3. The Queue lists scheduled posts and what happened to each. Failures name
   the network and its reason; rate limits and short outages are retried by
   themselves.

On a server the scheduler has to run for scheduled posts to go out:
`./buddy dev` runs it, and in production run `./buddy schedule:run` beside
the app. The Queue page says when it has stopped.
