# Inbox, Listening, and Analytics

## Inbox

Open **Inbox** to check direct messages from connected Bluesky and Mastodon accounts. Filter by network or account, choose a conversation, and use the reply box. **Sync now** pulls recent conversations. The scheduler checks periodically while Postline is running.

## Listening

Open **Listening** and create a rule with the terms and networks you want to watch. Bluesky, X, and Mastodon are available to rules. Use **Scan now** to check without waiting for the next scheduled scan. Apply the watch or network filter to narrow the matches. Use the original post link to read the conversation on its network.

## Analytics

Publishing totals come from posts sent through Postline. Engagement comes from networks that supply metrics to the sync job. Postline currently syncs Bluesky engagement. A post with missing metrics still contributes to publishing totals once it is sent. Check the source network and date range before comparing engagement.

**Best window** compares average interactions for measured posts by day of week and hour in the last 30 days. Each comparison requires enough samples in at least two groups and a unique highest average. The scheduler refreshes engagement periodically.
