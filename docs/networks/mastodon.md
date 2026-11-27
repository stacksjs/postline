# Mastodon

**You need:** your instance's address and an access token.

1. On your instance, open **Preferences > Development > New application**.
   Name it "Postline" and give it the scopes `read` and `write`. Save.
2. Open the application and copy **Your access token**.
3. In Postline, open **Settings > Channels > Mastodon**, enter the instance
   address (`https://mastodon.social`) and the token, and connect.

- **Limits:** whatever your instance allows, 500 characters on most; up to four
  images. Visibility and content warnings are set per post in the composer.
- **Inbox:** direct conversations (posts with Mentioned people only visibility)
  appear in Direct messages. Public replies and mentions use the token’s
  `read:notifications` scope, which is included in `read`. Choose **Reply**
  in **Inbox > Replies and mentions** to answer from the receiving account.
  Replies to unlisted posts stay unlisted.
- **Analytics:** Postline reads likes, boosts and replies through the account
  that published each post. Private posts require the token's read scope.
  [Mastodon status API](https://docs.joinmastodon.org/methods/statuses/#get).
- Revoke access at any time by deleting the application on your instance.
