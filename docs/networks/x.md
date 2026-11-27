# X

## API connection

**You need:** an X developer app with OAuth 2.0, and credits: X charges for
API use per post.

1. Open [developer.x.com](https://developer.x.com), sign in, and open your
   project's app (create one if you have none).
2. Under **User authentication settings**, choose **Set up**: OAuth 2.0, app
   type **Web App**. Paste the redirect address from Postline's Settings,
   Channels as the **Callback URI**, and your site as the **Website URL**.
3. Under **Keys and tokens**, copy the **OAuth 2.0 Client ID** and **Client
   Secret** into Postline under **Settings > Channels > Your network apps > X**,
   save, and connect.

Postline asks for `tweet.read`, `tweet.write`, `media.write` for image uploads,
`users.read` and `offline.access` (so the sign-in can renew itself). Reconnect
older X accounts to grant the image upload scope.

- **Cost:** X bills per call against credits you buy in advance. As checked in
  October 2026 a post costs about $0.015 and a post containing a link about
  $0.20. Crossposting an article is a link post every time. X changes these
  prices often; check the developer portal before relying on them. Postline
  adds nothing on top.
- **Daily read budget:** `TWITTER_DAILY_READ_BUDGET_USD` defaults to $2 per
  workspace and resets at midnight UTC. Postline reserves the maximum cost
  before profile lookups, Listening searches, and cleanup reads. Check the
  estimate in Settings > Channels > Your network apps > X and actual charges
  in the X Developer Console. The cap covers reads from this workspace. X
  publishes [current per-resource prices](https://docs.x.com/x-api/getting-started/pricing).
- **Deleting:** X allows 50 deletions per 15 minutes; cleanup paces itself to
  that, so a large cleanup takes hours.
- **No inbox:** X direct messages are not supported.
- **Limits:** 280 characters, up to four images. Write a thread in the
  composer's Thread mode to go longer.

## Browser session on the Mac

In a Postline build with isolated WebKit windows, open **Settings > Channels >
X browser session** and choose **Open X**. Sign in directly on X, then return
to Postline and choose **Check sign-in**. This requires macOS 14 or later.
WebKit keeps the sign-in on this Mac, and Postline remembers the confirmed
handle. To sign out, use X's menu in that window and check the session again.
X [restricts scripted website use](https://help.x.com/en/rules-and-policies/x-automation).

With your profile open in the X window, choose **Read visible engagement** in
Postline. Exact counts shown on your own posts update matching published posts
in Analytics. This reads the open page through WebKit and needs no developer
app credentials.
