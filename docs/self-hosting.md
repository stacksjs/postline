# Running Postline on a server

The Mac app is the simplest way to run Postline: it needs no server, no
domain and no certificate. Run it on a server when you want it reachable from
more than one machine, or running while your Mac sleeps.

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

| Variable | Why |
|---|---|
| `APP_KEY` | Encrypts the network tokens in the database. Back it up with the database: without it every account has to be reconnected |
| `MAIL_MAILER` and its settings | So alerts reach you by email. Without a mailer they stay in the app |
| `POSTLINE_ALERT_WEBHOOK_URL` | Alerts to Slack, Discord or your own service |

Every variable Postline reads is listed, with what it does, in `.env.example`.
