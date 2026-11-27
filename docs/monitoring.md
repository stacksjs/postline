# Inbox, Listening, and Analytics

## Inbox

Open **Inbox** to check direct messages from connected Bluesky and Mastodon accounts. Filter by network or account, choose a conversation, and use the reply box. **Sync now** pulls recent conversations. The scheduler checks periodically while Postline is running.

Choose **Replies and mentions** to see public activity for connected Bluesky and Mastodon accounts. **Sync public activity** checks for new items immediately. Mark items as read in Postline, or open the original post to reply on the network. Sync checks a recent window of notifications per account. Postline keeps collected items for up to 90 days.

## Listening

Open **Listening** and create a rule with the terms and networks you want to watch. Bluesky, X, and Mastodon are available to rules. Use **Scan now** to check without waiting for the next scheduled scan. Apply the watch or network filter to narrow the matches. Use the original post link to read the conversation on its network.

For an X watch on the Mac, choose **X browser session** under **X source**
to import visible Search or Mentions results yourself. Open those results in
the X window, then choose **Import visible mentions** in Channels. Follow the
[X browser session setup](./networks/x.md#browser-session-on-the-mac).

## Analytics

Publishing totals come from posts sent through Postline. Bluesky and Mastodon
report engagement using their existing connections. LinkedIn, Instagram, and
Threads require opt-in read access in **Settings > Channels > Your network
apps**. The **Engagement by network** list shows the counts each network
reports. Unmeasured posts still count toward publishing totals.

**Best channel** and **Best window** compare likes or reactions plus replies
per measured post in the last 30 days. The hour uses your workspace time
zone. Each comparison requires enough samples in two groups and a unique
highest average. The scheduler refreshes engagement periodically.

X has two ways to refresh engagement. To use its API, enable paid reads in
the X network app settings, then select **Refresh engagement** in Analytics.
Each refresh shares the workspace's daily X read budget. On the Mac, you
can also open your profile in the X window and choose **Read visible
engagement** in Channels to import exact counts for matching Postline posts.
