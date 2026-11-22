import process from 'node:process'
import { schedule } from '@stacksjs/scheduler'

/**
 * **Scheduler**
 *
 * Define your scheduled tasks here. Jobs, actions, and shell commands
 * can all be scheduled with a fluent, expressive API.
 *
 * @see https://docs.stacksjs.com/scheduling
 */
export default function () {
  // Publish scheduled Postline posts as they come due
  // Never two at once: the next tick starts whether or not the last one has
  // finished, and a run that is still publishing must not be joined.
  schedule
    .job('PublishScheduledPosts')
    .everyMinute()
    .withoutOverlapping(10)

  // Refresh Bluesky engagement counts for the analytics page
  schedule
    .job('SyncEngagementMetrics')
    .everyThirtyMinutes()
    .withoutOverlapping(30)

  // Watch configured brand and product keywords across connected networks
  schedule
    .job('ScanKeywordMonitors')
    .everyFiveMinutes()
    .withoutOverlapping(5)

  // Mirror new direct messages into the inbox
  schedule
    .job('SyncDirectMessages')
    .everyFiveMinutes()
    .withoutOverlapping(5)

  // Delete posts older than the retention period, when it is switched on in
  // Settings. Daily: the setting is in days, and each run pages through every
  // connected account's history, which the networks rate-limit.
  schedule
    .job('AutoDeletePosts')
    .daily()
    .withoutOverlapping(120)

  // Renew network tokens close to expiry, so an account nobody posts from
  // for weeks is still connected when it is needed.
  schedule
    .job('KeepTokensAlive')
    .daily()
    .withoutOverlapping(30)

  // Remove sign-in tokens that have expired or been revoked. Every sign-in
  // mints one and nothing else deletes them, so the table only ever grew.
  schedule
    .command('./buddy auth:prune')
    .daily()

  // Run a custom action every five minutes
  // schedule.action('CleanupTempFiles').everyFiveMinutes()

  // Run a shell command daily at midnight
  // schedule.command('echo "Daily maintenance complete"').daily()
}

// SIGTERM as well as SIGINT: a deploy stops the scheduler with SIGTERM, and
// unhandled it killed the process in the middle of whatever it was
// publishing. A post cut off like that is recovered on the next start (see
// `recoverStranded`), but it is better not to cut it off.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    schedule.gracefulShutdown().then(() => process.exit(0))
  })
}
