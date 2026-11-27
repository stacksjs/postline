# Instagram

**You need:** an Instagram **Business or Creator** account linked to a
**Facebook Page**, and a Meta developer app with Facebook Login for Business.
Free.

1. In the Instagram app, switch to a professional account (Business or
   Creator) and link it to a Facebook Page you manage.
2. Open [developers.facebook.com/apps](https://developers.facebook.com/apps),
   create a **Business** app, and add **Facebook Login for Business** and the
   **Instagram Graph API**.
3. Under Facebook Login settings, add the redirect address from Postline's
   Settings, Channels as a **Valid OAuth Redirect URI**.
4. Under **App settings > Basic**, copy the **App ID** and **App Secret** into
   Postline under **Settings > Channels > Your network apps > Instagram**,
   save, and connect.
5. After Meta sends you back to Postline, select the Facebook Page linked to
   the Instagram account you want to use, then choose **Connect account**.

Postline asks for `instagram_basic`, `instagram_content_publish`,
`pages_show_list` and `pages_read_engagement`.

- **Every post needs an image.** Instagram rejects text-only posts. Instagram
  fetches the image from a public address: on a laptop or in the Mac app,
  switch on **Settings > General > Share images through a temporary link**.
- **App review** is only needed to post for accounts you do not own. Your own
  account works with the app in development mode, with you in an app role.
  Meta asks for a privacy-policy URL before an app can go live.
- **No inbox:** Instagram messages need Meta's app review (Advanced Access),
  which an app made for one person does not get.
- **No deleting:** the API cannot delete Instagram posts.
- **Limits:** 2,200 characters in a caption, up to four images.

## Engagement metrics

Grant the app `instagram_manage_insights`, then enable **Read engagement metrics** in its Postline network app settings and reconnect. The connected Facebook account needs permission to analyze the linked Page.
Postline stores the Facebook User token for insights separately from the Page
token it uses to publish. If you connect with a Page token in `.env`, provide
the Facebook User token in `INSTAGRAM_INSIGHTS_ACCESS_TOKEN`. [Provider
documentation](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights).

## First comments

Grant `instagram_manage_comments` in your Meta app. Enable **Publish first
comments** in its Postline network app settings, then reconnect Instagram.
If you set up Instagram with a Page token in `.env`, set
`INSTAGRAM_FIRST_COMMENTS=true` and provide a Facebook User token with
the comment permission in `INSTAGRAM_COMMENTS_ACCESS_TOKEN`.

In Composer, select Instagram and open **First comments**. Postline sends the
comment after the first post goes live. A refused comment can be retried from
**Queue > Needs attention**. If delivery is uncertain, check the published
post for the comment. [Meta comments API](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-media/comments#creating)
