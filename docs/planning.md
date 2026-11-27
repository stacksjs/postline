# Scheduling and campaigns

## Set the schedule

Choose **Settings > General > Time zone** before scheduling. The composer interprets the selected date and time in that zone. Open **Queue** to switch between List and Calendar or edit a scheduled post. Queue search matches labels and post copy, including network variants.

Scheduled posts need a running scheduler. Closing the Mac window leaves Postline running in the menu bar. Quitting Postline or putting the Mac to sleep can delay publishing. For a server installation, keep `./buddy schedule:run` running beside the web and API processes. A scheduler warning appears in the Queue when it stops checking in.

## Fill recurring posting slots

Open **Queue > Posting slots** and add the weekdays and times you want for each network. In the Composer’s publishing menu, choose **Add to queue** for a new post or a saved draft. Postline takes the next free time in the workspace time zone for each selected network. Multiple accounts on one network share a slot. If you select several networks, each appears separately in the Queue, so you can move or edit them independently.

A time that disappears when the clocks go forward is skipped. Adding or removing slots applies to future uses of **Add to queue**. Already scheduled times stay in the Queue.

## Repeat or recycle a post

From a draft, scheduled, or published post in **Queue**, open **More post actions > Repeat…**. Choose the first publishing time and a daily, weekly, or monthly repeat. The rule saves its own copy of the post, including the full thread, account targets, and available images. If a published post’s original uploads have been cleaned up, the form can repeat without them when the selected networks accept text.

**Queue > Recurring posts** shows the next time for each rule and lets you edit its schedule, pause, resume, or remove it. A repeat uses the time zone shown on its rule. Monthly repeats on the 29th through 31st move to the last day in shorter months. A time that falls in a daylight-saving gap is skipped. After an outage, Postline only queues a repeat that falls within the usual publishing grace period. Once Postline queues an occurrence, it works like any other scheduled post, including the usual retry controls.

## Pause, resume, and handle missed posts

Use **Settings > General > Pause scheduled publishing** or the Mac menu-bar control. Scheduled posts stay in the Queue until you resume. You can still publish manually while paused.

When the scheduler resumes, posts due within the last 30 minutes can still go out. Older posts move to **Needs attention** as missed. Review the copy, then publish now or set a new date. Server operators can adjust this grace period with `POSTLINE_LATE_GRACE_MINUTES`.

The Queue shows failures by account. Transient failures may retry automatically. For a partially sent post, **Retry failed networks** leaves the successful results intact. If a thread stops partway through, **Resume thread** continues from the failed segment.

## Turn a feed into drafts

Open **Queue > Draft feeds** and add a public RSS, Atom, or JSON feed. Postline checks the feed when you add it and every 30 minutes while the scheduler is running. Select **Create drafts for items already in the feed** to bring in existing entries. Each new entry creates one draft with its title and public link. Open **Queue > Drafts** and choose channels when you are ready to edit, schedule, or publish it.

Use **Check now** for an immediate refresh. Pausing or removing a feed keeps the drafts it created. Deleting a draft leaves the feed entry marked as seen, so the next check does not recreate it.

## Build a campaign

Open **Campaigns** and create a brief with an objective, audience, tone, and date range. Add planned posts by hand or ask the planner to draft a sequence. Review the copy, channels, and timing. Send the posts you want to publish to the Queue. A draft on the campaign board needs to be queued before the scheduler can publish it.

## Configure campaign AI

The built-in planner works with an empty provider setting. In **Settings > AI**, choose OpenAI, Anthropic, or Ollama for model-generated plans and revisions. For OpenAI or Anthropic, paste your own API key. For Ollama, start it on the machine running Postline. Specify a model or use the default. Save, then check **Planning uses** to confirm which provider is active. A saved provider setting takes precedence over the server's environment defaults.

Campaign requests send the brief and channel details to the selected provider. Review the campaign draft before sending it to the Queue. [Security and privacy](./security.md).
