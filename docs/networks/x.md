# X

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

Postline asks for `tweet.read`, `tweet.write`, `users.read` and
`offline.access` (so the sign-in can renew itself).

- **Cost:** X bills per call against credits you buy in advance. As checked in
  October 2026 a post costs about $0.015 and a post containing a link about
  $0.20. Crossposting an article is a link post every time. X changes these
  prices often; check the developer portal before relying on them. Postline
  adds nothing on top.
- **Deleting:** X allows 50 deletions per 15 minutes; cleanup paces itself to
  that, so a large cleanup takes hours.
- **No inbox:** X direct messages are not supported.
- **Limits:** 280 characters, up to four images. Write a thread in the
  composer's Thread mode to go longer.
