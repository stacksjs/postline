# Connecting networks

Postline posts as you through each network's own API. It has no keys of its
own: for the networks that sign in with OAuth you register a small developer
app of your own and enter its id and secret under **Settings > Channels**.
That app, its terms and any costs are between you and the network.

On the Mac, you can also use your own [X browser session](./x.md#browser-session-on-the-mac)
to import visible posts into Listening or update engagement for posts
already in Postline. You can use that session alongside an API connection
for publishing.

| Network | What you need | Minutes | Cost |
|---|---|---|---|
| [Bluesky](./bluesky.md) | Your handle and an app password | 1 | Free |
| [Mastodon](./mastodon.md) | Your instance and an access token | 2 | Free |
| [LinkedIn](./linkedin.md) | A LinkedIn developer app | 10 | Free |
| [Threads](./threads.md) | A Meta app with the Threads API | 15 | Free |
| [Instagram](./instagram.md) | A Meta app, a Business or Creator account and a Facebook Page | 20 | Free |
| [X](./x.md) | An X developer app with OAuth 2.0 for publishing | 15 | Paid API calls |

The redirect address each OAuth network asks for is shown under **Settings >
Channels**, next to the fields: `https://<your address>/api/postline/<network>/callback`,
where `<network>` is `twitter` for X. In the Mac app it is a local address the
app shows you.

After saving an OAuth developer app, choose **Test connection** and complete the
network's sign-in. A passing test returns you to Channels. Choose **Connect**
on the channel card to enable publishing. The X test includes a profile read
that counts against the workspace's daily read budget.

## What each network can do in Postline

| | Publish | Threads | Images | Delete | Inbox | Listening | Engagement numbers |
|---|---|---|---|---|---|---|---|
| Bluesky | Yes | Yes | Up to 4 | Yes | Yes | Yes | Yes |
| Mastodon | Yes | Yes | Up to 4 | Yes | Yes | Yes | Yes |
| X | Yes | Yes | Up to 4 | Yes | No | API or Mac browser session | Paid API refresh or visible counts from the Mac browser session |
| LinkedIn | Yes | No | Up to 4 | Yes | No | No | With approved scopes |
| Threads | Yes | No | Up to 4 | Up to 100 a day | No | No | With insights access |
| Instagram | Yes, with an image | No | Required, up to 4 | No | No | No | With insights access |
