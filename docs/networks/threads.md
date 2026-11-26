# Threads

**You need:** a Meta developer app with the Threads API, and your Threads
account added as a tester. Free.

1. Open [developers.facebook.com/apps](https://developers.facebook.com/apps)
   and create an app with the **Access the Threads API** use case.
2. In the Threads API settings, add the redirect address from Postline's
   Settings, Channels as a **Redirect Callback URL**.
3. Under **App roles**, add your Threads account as a **Threads tester**, then
   accept the invitation in the Threads app (Settings > Account > Website
   permissions).
4. Copy the **Threads App ID** and **Threads App Secret** into Postline under
   **Settings > Channels > Your network apps > Threads**, save, and connect.

Postline asks for `threads_basic` and `threads_content_publish`. An app in
development mode posts only for its testers, which is all a single-owner
install needs: no app review.

- **Limits:** 500 characters, up to four images. Threads fetches images from a
  public address: on a laptop or in the Mac app, switch on **Settings >
  General > Share images through a temporary link**.
- **Deleting:** Threads allows 100 deletions a day per profile; cleanup stops
  at that and says so.
- **No inbox:** Threads has no messaging API.
