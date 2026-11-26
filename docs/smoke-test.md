# Smoke test

Run by hand on a release candidate, in the app with a workspace that has at
least one connected network. Each step is something the automated checks
cannot see. Add a step when a fix can only be confirmed by using the app.

## Composer

1. **Long-form editor after navigation.** Open Queue, then the composer from
   the sidebar (not a reload). Choose the blog as a target: the formatting
   toolbar appears. Reload with a saved draft in the composer and check it
   again.
2. **The link after publishing.** Publish to one network. The toast's button
   names that network ("Open on X", "Open on LinkedIn"); a Mastodon post says
   "Open post".
3. **"Post updated" stays.** Edit a queued post and save it. You land on
   Queue and the "Post updated" toast is still on screen.
4. **Undo a removed post.** In Thread mode, write in a second post and remove
   it. A "Post 2 removed" toast offers Undo, which puts it back with its text.
   Removing an empty post shows nothing.
5. **Unsaved edits are held.** Edit a queued post, change the text, and click
   another view in the sidebar. You stay in the composer and a toast offers
   "Leave without saving". Closing the window asks too.
6. **Accounts that fail to load.** Stop the API (or go offline) and open the
   composer. It says "Couldn't load your accounts. Try again", not "No
   accounts yet". Start the API and press it: the chips appear.
7. **Connect from the composer.** A network with no account shows as a dashed
   "Connect …" chip. Clicking it opens Channels.
