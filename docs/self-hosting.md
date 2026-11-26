# Running Postline on a server

The Mac app is the simplest way to run Postline: it needs no server, no
domain and no certificate. Run it on a server when you want it reachable from
more than one machine, or running while your Mac sleeps.

## Run with Docker

From a Postline checkout, build the image and start a container with one named
volume.

```bash
docker build --file cloud/Dockerfile --tag postline .
docker run --detach --name postline --restart unless-stopped \
  --publish 127.0.0.1:3000:3000 \
  --volume postline-data:/var/lib/postline postline
```

Open <http://localhost:3000> to create the workspace account. The image runs
the web server, API and scheduler together, and applies migrations on startup.
The volume holds SQLite, media, published Blog Markdown, and the application
key. Reuse that volume when replacing the container. For a restored workspace,
put the original key in the volume as `app-key` before the first start. If you
supply `APP_KEY`, it must match the stored key when the volume already has one.

For remote access, set `APP_URL` to the public HTTPS address and use a reverse
proxy for TLS. Run one Postline container per volume so one scheduler owns the
queue.

## Run from source

Follow the [README setup commands](https://github.com/stacksjs/postline#getting-started)
to install dependencies, generate an application key, and apply migrations.
In `.env`, set `APP_ENV=production`, `DEBUG=false`, and `APP_URL` to the HTTPS
address where people will open Postline. Set `PORT_API=3008` so the web server
can find the API. Use the same `.env` and workspace database for each process.

Start each command in its own service so it can restart after a reboot.

```bash
./buddy serve
```

```bash
./buddy serve:api --port 3008
```

```bash
./buddy schedule:run
```

Route public traffic to the web server on port `3000` and keep the API port
private. The Queue and Activity pages report whether the scheduler is running.

## The address it answers on

Set `APP_URL` to the address people type, for example
`APP_URL=postline.example.com`. Postline uses it for links in emails, for the
redirect addresses you give each network, and to decide how the sign-in
cookie is sent.

## HTTPS is required beyond your own machine

When `APP_URL` is anything other than `localhost` or `127.0.0.1`, the sign-in
cookie is marked `Secure`, so browsers only send it over HTTPS. On plain
`http://` the sign-in appears to work and the next page asks you to sign in
again.

This is deliberate, and there is no switch to turn it off: the cookie is the
whole session, and on plain HTTP anyone on the same network can read it and
use it. Passkeys refuse plain HTTP for the same reason.

### On a local network

A Postline on a home server or a NAS, reached as `postline.lan` or
`192.168.1.20`, still needs HTTPS. Two ways that take a few minutes:

- **Tailscale.** On the machine running Postline, `tailscale serve --bg 3000`
  gives it an HTTPS address on your tailnet, such as
  `https://postline.your-tailnet.ts.net`, with a certificate every device on
  the tailnet trusts. Set `APP_URL` to that address.
- **A reverse proxy with its own certificate authority.** [Caddy](https://caddyserver.com)
  with `tls internal` serves Postline over HTTPS and issues the certificate
  itself:

  ```
  postline.lan {
    tls internal
    reverse_proxy 127.0.0.1:3000
  }
  ```

  Each device that opens Postline has to trust Caddy's root certificate once
  (`caddy trust` on the server prints where it is).

If the browser reaches Postline at an address other than `APP_URL`, set
`PASSKEY_ORIGIN` to the address it shows, or passkeys will be refused.

### On the internet

Use a domain you own and a certificate from Let's Encrypt. Caddy does both
with one line per site:

```
postline.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

## What else to set

See [Back up and restore a Postline server](recovery.md) for encrypted off-site
recovery of your database, media, and application key.

| Variable | Why |
|---|---|
| `APP_KEY` | Encrypts the network tokens in the database. Back it up with the database: without it every account has to be reconnected |
| `MAIL_MAILER` and its settings | So alerts reach you by email. Without a mailer they stay in the app |
| `POSTLINE_ALERT_WEBHOOK_URL` | Alerts to Slack, Discord or your own service |

See the [environment reference](environment.md) for storage, scheduling, and
backup settings and a link to the full `.env.example` template.
