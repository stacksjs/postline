# X

## API connection

**You need:** an X developer app with OAuth 2.0, and credits: X charges for
API use per post.

1. Open [developer.x.com](https://developer.x.com), sign in, and open your
   project's app (create one if you have none).
2. Under **User authentication settings**, set up OAuth 2.0. Choose
   **Native App** for the Mac or **Web App** for a hosted workspace. Paste
   the redirect address from **Settings > Channels > Your network apps > X**
   as the **Callback URI**, and enter your site as the **Website URL**.
3. Copy the **OAuth 2.0 Client ID** from **Keys and tokens** into Postline.
   For a Native App, select **Use a public X app with a client ID only**.
   For a Web App, also enter the **Client Secret**. Save, then use **Test
   connection** or connect the account from its channel card.

[X OAuth app types and PKCE](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code)

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
  before profile lookups, Listening searches, cleanup reads, and engagement
  refreshes and direct-message pages. Check the estimate in Settings > Channels > Your network apps > X
  and actual charges
  in the X Developer Console. The cap covers reads from this workspace. X
  publishes [current per-resource prices](https://docs.x.com/x-api/getting-started/pricing).
- **Deleting:** X allows 50 deletions per 15 minutes; cleanup paces itself to
  that, so a large cleanup takes hours.
- **Engagement:** Allow paid engagement reads in the X network app settings
  or set `TWITTER_ENGAGEMENT_METRICS=true`. Select **Refresh engagement** in
  Analytics to update counts for up to 100 recent posts per connected X
  account. X's public metrics use the existing `tweet.read` scope.
- **Limits:** 280 characters, up to four images. Write a thread in the
  composer's Thread mode to go longer.

### Direct messages through the API

Enable paid X API direct messages in **Settings > Channels > Your network apps > X**,
save, then reconnect each account you want to use in Inbox. The consent screen
adds `dm.read` and `dm.write`. Self-hosted installs can set
`TWITTER_DIRECT_MESSAGES=true`. A `TWITTER_ACCESS_TOKEN` must be an X user token
with both scopes.

Choose **Sync X messages** for the account in Inbox. Each click requests one
page of up to 25 message events and their senders, with a maximum estimated
read cost of $0.50 at the published rates. **Load older from X** requests the
next history page. X's lookup endpoint serves up to 30 days of events. Postline
keeps imported messages locally, so reopening or polling Inbox does not make
paid requests. The daily read cap applies to both buttons, and incomplete
syncs resume from their saved cursor. The Inbox shows the estimate before a
read and lists the per-reply charge on the send button. Current charges are
listed in [X API pricing](https://docs.x.com/x-api/getting-started/pricing).

Inbox sends text replies to existing conversations. Media-only messages show
an attachment notice. Open X to view the media.

## Browser session on the Mac

In a Postline build with isolated WebKit windows, open **Settings > Channels >
X browser session** and choose **Open X**. Sign in directly on X, then return
to Postline and choose **Check sign-in**. This requires macOS 14 or later.
WebKit keeps the sign-in on this Mac, and Postline remembers the confirmed
handle. To sign out, use X's menu in that window and check the session again.
If X asks you to verify your account during an import, Postline pauses browser
reads, records an alert in Activity, and brings the X window forward. The pause
survives a reload. Complete the check there, then
select **Check sign-in** in Postline.
If Postline finds visible results it cannot read, it also pauses browser
imports and records the reason in Activity. Open a loaded Search or Mentions
page in X, then select **Check sign-in** in Postline to check the layout again.
X [restricts scripted website use](https://help.x.com/en/rules-and-policies/x-automation).

Choose **Open X profile** to bring up your profile in the X window. Once it loads,
choose **Read visible engagement** in Postline. Exact counts shown on your own posts update matching published posts
in Analytics. This reads the open page through WebKit and needs no developer
app credentials.

For Listening, create an active watch with **X** selected and choose **X
browser session** under **X source**. Choose **Open X Mentions** in Channels, or
open Search in the X window. Once the results load, choose **Import visible mentions**. Posts matching the
watch appear in Listening. Browser-session watches do not make scheduled X API
requests. If you also chose other networks, the scheduler still checks those.

Enable **Check X in the background** on a watch to search X while the Mac app
is running, including when it’s in the menu bar. Postline checks one enabled
watch every 20 minutes and rotates through the enabled watches in turn. Pausing a watch or turning the option off stops its background checks.

Select your **X browser** account in Composer to publish a thread now or
schedule it from Queue. Postline populates each segment in X’s Composer and
uses **Post all**. If X confirms only some segments, Queue shows the
confirmed posts and holds the unresolved segments for review.

If X does not confirm a browser submission, Queue holds that target to prevent
duplicate sends. Choose **Find on X** to open the original account’s profile.
Open the matching post in that window, then return to Queue and choose
**Link open X post**. Check the text and any images before confirming. A verified
match appears as published in Queue.

To remove a published browser post, open the post’s **More actions** menu in
Queue and choose **Delete from X**. Confirm the account and post in the dialog.
Postline uses that post’s menu in the isolated X window. A confirmed deletion
keeps the Queue history and removes the live link. If X does not confirm the
deletion, open the post on X to check whether it is still available.
