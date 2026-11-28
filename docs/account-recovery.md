# Recover the owner account

Use a registered passkey to sign in if you still have it. To reset the
password from the server, use the same email address you entered during
first-run setup.

## Docker

Run the command inside the running container. Substitute your container name
if you used a name other than `postline`.

```bash
docker exec postline bun scripts/serve-container.ts buddy user:add owner@example.com --update
```

## Source install

Run the command from the current Postline checkout on the server so it uses
that install's database configuration.

```bash
./buddy user:add owner@example.com --update
```

The command prints the generated password once. Save it in your password
manager and sign in to your usual Postline address.

## Lost authenticator and recovery codes

Add `--without-two-factor` to the same command. It resets the password, clears
the authenticator, and invalidates the old recovery codes. Sign in with the new
password, then set up two-factor sign-in again in **Settings > Account** and
save the new recovery codes.
