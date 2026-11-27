# Compose a post

Open **Composer** and select the connected accounts you want to publish to. If you have multiple accounts on a network, choose each account by its handle. An account marked **Connect** needs setup before it can receive a post. [Connect a network](./networks/index.md).

## Shared text and network variants

Write the shared text in **Single** mode. The character count reflects the selected networks. If one network's copy needs a shorter version, different wording, or a different link, open **Customize per network** and enter its text. A variant applies to every selected account on that network. Review the variants again after changing the shared text. Removing a variant restores the shared text for that network.

## Reuse saved text

Open **Saved text** in Composer to create, edit, or delete a snippet, post template, or hashtag set. For hashtags, enter names with or without `#` and separate them with spaces or commas. Select an item and choose **Insert in post** to add it to the active post or thread segment. The copy in your post is editable and stays there if you change or delete the saved item later.

## Threads

Select **Thread** and add one segment for each post. Check the limits while editing each segment. Thread-capable networks publish subsequent segments as replies. The composer identifies channels that can only receive the first segment. Variants are available in Single mode. In a thread, each segment uses the shared text.

## Images, video and link cards

Use **Attach images or video** to add up to four images or one MP4 to the first post. Fill in the attachment’s **Alt text** field. Video is available for Bluesky and Mastodon, up to 40 MiB in Postline. Your Mastodon instance may set a lower limit. A video draft in Queue retains the file and its description so you can reopen it or retry a failed send.

Bluesky displays the attachment in place of a link card when both are present. Instagram needs an image it can fetch over the internet. [Check Instagram setup](./networks/instagram.md).

To track a link, open **Analytics > Tracked links**. Enter the full destination address and the UTM tags your destination's analytics expects. **Build tagged URL** gives you a link to copy into a post. On a server with a public HTTPS `APP_URL`, you can also name the link and choose **Create short link**. Postline reports all-time redirects for each short link, including repeat visits and automated previews. Disabling a short link stops it from working wherever it was shared.

## Share a page from your browser

Build **Share to Postline** from the Postline checkout after installing its dependencies.

```bash
./buddy extension:package
```

- In Chrome or Chromium, open **Extensions**, turn on **Developer mode**, choose **Load unpacked**, and select `dist-extension/chrome`.
- To try it in Firefox 142 or later, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select the generated `share-to-postline-<version>-firefox.zip`. Firefox removes temporary add-ons when it restarts.

On a page you want to share, open **Share to Postline** from the toolbar. Enter the HTTPS address of your web workspace and choose **Open in Composer**. The extension remembers that address in your browser. Sign in if asked, review the link, then choose **Add link to post**. It appends to the active post or thread segment and leaves the rest of your work intact.

The extension reads the current tab when you open its popup. The link stays in the browser during the handoff. After you add it, Postline can request a link preview and sends the link with any post you save or publish.

## Draft, schedule, or publish

- Choose **Draft** and save to put a post in **Queue > Drafts**. The composer also keeps an in-progress draft in the current browser or Mac app.
- Open **Schedule post**, pick a date and time in the workspace's time zone, then choose **Schedule**. [How scheduling works](./planning.md).
- Choose **Publish** to send immediately. The Queue shows the result for each selected account.
