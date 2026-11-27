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
