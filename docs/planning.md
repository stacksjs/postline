# Scheduling and campaigns

## Set the schedule

Choose **Settings > General > Time zone** before scheduling. The composer interprets the selected date and time in that zone. Open **Queue** to switch between List and Calendar or edit a scheduled post. Queue search matches labels and post copy, including network variants.

Scheduled posts need a running scheduler. Closing the Mac window leaves Postline running in the menu bar. Quitting Postline or putting the Mac to sleep can delay publishing. For a server installation, keep `./buddy schedule:run` running beside the web and API processes. A scheduler warning appears in the Queue when it stops checking in.

## Pause, resume, and handle missed posts

Use **Settings > General > Pause scheduled publishing** or the Mac menu-bar control. Scheduled posts stay in the Queue until you resume. You can still publish manually while paused.

When the scheduler resumes, posts due within the last 30 minutes can still go out. Older posts move to **Needs attention** as missed. Review the copy, then publish now or set a new date. Server operators can adjust this grace period with `POSTLINE_LATE_GRACE_MINUTES`.

The Queue shows failures by account. Transient failures may retry automatically. For a partially sent post, **Retry failed networks** leaves the successful results intact. If a thread stops partway through, **Resume thread** continues from the failed segment.

## Build a campaign

Open **Campaigns** and create a brief with an objective, audience, tone, and date range. Add planned posts by hand or ask the planner to draft a sequence. Review the copy, channels, and timing. Send the posts you want to publish to the Queue. A draft on the campaign board needs to be queued before the scheduler can publish it.

## Configure campaign AI

The built-in planner works with an empty provider setting. In **Settings > AI**, choose OpenAI, Anthropic, or Ollama for model-generated plans and revisions. For OpenAI or Anthropic, paste your own API key. For Ollama, start it on the machine running Postline. Specify a model or use the default. Save, then check **Planning uses** to confirm which provider is active. A saved provider setting takes precedence over the server's environment defaults.

Campaign requests send the brief and channel details to the selected provider. Review the campaign draft before sending it to the Queue. [Security and privacy](./security.md).
