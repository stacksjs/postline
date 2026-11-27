# Creating posts from scripts

On the machine that runs your workspace, complete first-run setup and apply
the usual migrations. As the operator of that machine, create a token for each
script or agent.

```bash
./buddy postline:token:create "Release announcements" --days 30
./buddy postline:token:list
./buddy postline:token:revoke 42
```

The create command prints the secret once. Save it in the caller's secret
store as `POSTLINE_TOKEN`. The list command prints IDs, names and expiry dates
for active automation tokens. Revoking a token takes effect on the next
request. The token can create drafts and scheduled posts and expires after
30 days by default. The maximum lifetime is 90 days.

## Command line

Set `POSTLINE_URL` to the workspace origin, for example
`https://postline.example.org`. Use the same key when retrying an operation.
Use a different key for each new post.

```bash
bun run postline create --key release-note-2027-01-20 --provider blog \
  --title "Release notes" --text "The new release is available."
```

Use `--at 2027-01-20T18:30:00Z` to schedule instead of saving a draft. Repeat
`--provider` for multiple targets. Leave out `--text` to read the body from
standard input.

## HTTP API

Send JSON to `POST /api/postline/v1/posts` with
`Authorization: Bearer <token>`, `Content-Type: application/json` and an
`Idempotency-Key` header. Use an opaque key of 1 to 128 ASCII letters,
digits, periods, underscores, hyphens or colons. The key belongs to the
workspace, so it remains valid if the caller rotates its token.

```json
{
  "text": "The new release is available.",
  "title": "Release notes",
  "providers": ["blog", "bluesky:12"],
  "scheduledAt": "2027-01-20T18:30:00Z"
}
```

`text` and `providers` are required. For a network with multiple accounts,
`bluesky:12` pins the post to that account. A bare network name follows its
default account when the scheduler publishes. Omit `scheduledAt` to save a
draft. The scheduler must be running for scheduled posts to go out.

A successful response is HTTP 201 and returns
`{ "ok": true, "data": { "postId": 42, "status": "draft", "scheduledAt": null } }`.
For a scheduled post, the receipt contains `"status": "scheduled"` and
the scheduled UTC time in `YYYY-MM-DD HH:MM:SS` format. Replaying the
original submission returns the original receipt. Reusing its key with
different content returns HTTP 409.

## Outgoing webhooks

Set these variables in the API and scheduler environments, then restart both
processes. Use a public HTTPS receiver that accepts a JSON POST.

```dotenv
POSTLINE_POST_WEBHOOK_URL=https://hooks.example.org/postline
POSTLINE_POST_WEBHOOK_SECRET=
```

Generate and store a signing secret with `openssl rand -hex 32`. Configure the
same secret at the receiver. Postline records the event with the post and sends
it through the usual scheduler. Deliveries stop at a redirect and never include
the post text, credentials, or the network's raw error.

| Event | When it is recorded |
| --- | --- |
| `post.created` | The automation API creates a draft or scheduled post. Replaying its key returns the receipt without creating another event. |
| `post.published` | A publish attempt succeeds on at least one target. Inspect `data.targets` for the result on each target in that attempt. |
| `post.failed` | A publish attempt succeeds on no targets, or the scheduler sets aside an unsent post. A target's `retryAt` gives the next scheduled publishing attempt when one is planned. |

```json
{
  "id": "8fc870ce-7b6f-4848-b3a0-f26fad15e898",
  "type": "post.published",
  "createdAt": "2027-01-20T18:30:00.000Z",
  "data": {
    "postId": 42,
    "status": "published",
    "targets": [{ "target": "blog", "status": "published" }]
  }
}
```

Verify the signature before using the event. Read the raw request body.
Compute the hexadecimal HMAC-SHA256 of
`Postline-Delivery + "." + Postline-Timestamp + "." + rawBody` with the
configured secret. Use a constant-time comparison against the value after
`sha256=` in `Postline-Signature`. The timestamp is Unix time in seconds.
Reject timestamps outside your replay window and deduplicate on
`Postline-Delivery`, which is the same as the JSON `id`.

Return any HTTP 2xx to acknowledge the event. Other responses or an unavailable
receiver are retried with exponential backoff starting at one minute, up to
eight attempts total. Each delivery keeps its event ID and body and is signed
with the current timestamp. Retries and outages can change arrival order.
Changing the receiver URL keeps old events bound to their original URL.
Postline keeps delivery records for 30 days.
