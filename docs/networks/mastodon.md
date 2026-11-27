# Mastodon

**You need:** your instance's address and an access token.

1. On your instance, open **Preferences > Development > New application**.
   Name it "Postline" and give it the scopes `read` and `write`. Save.
2. Open the application and copy **Your access token**.
3. In Postline, open **Settings > Channels > Mastodon**, enter the instance
   address (`https://mastodon.social`) and the token, and connect.

- **Limits:** 500 characters on most instances. Postline accepts up to four
  images or one MP4 video within your instance’s limits. Set visibility and
  content warnings in Composer.
- **Polls and quotes:** choose **Mastodon poll or quote** in Composer. Poll
  limits come from your instance. Quoting requires an instance that
  supports quote posts and the `read:search` scope, which is included in
  `read`. Choose a poll, a quote, or media for each post. In threads, the poll or
  quote goes on the first post.
- **Inbox:** direct conversations (posts with Mentioned people only visibility)
  appear in Direct messages. Public replies and mentions use the token’s
  `read:notifications` scope, which is included in `read`. Choose **Reply**
  in **Inbox > Replies and mentions** to answer from the receiving account.
  Replies to unlisted posts stay unlisted.
- **Analytics:** Postline reads likes, boosts and replies through the account
  that published each post. Private posts require the token's read scope.
  [Mastodon status API](https://docs.joinmastodon.org/methods/statuses/#get).
- Revoke access at any time by deleting the application on your instance.
