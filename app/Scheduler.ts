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
  // Run the Inspire job every hour
  schedule
    .job('Inspire')
    .hourly()
    .setTimeZone('America/Los_Angeles')

  // Publish scheduled Postline posts as they come due
  schedule
    .job('PublishScheduledPosts')
    .everyMinute()

  // Refresh Bluesky engagement counts for the analytics page
  schedule
    .job('SyncEngagementMetrics')
    .everyThirtyMinutes()

  // Watch configured brand and product keywords across connected networks
  schedule
    .job('ScanKeywordMonitors')
    .everyFiveMinutes()
    .withoutOverlapping(5)

  // Deliver queued newsletter sends. Every minute, because a reader expects a
  // post to arrive when it is published, not on the next half hour.
  schedule
    .job('DeliverNewsletters')
    .everyMinute()
    .withoutOverlapping(5)

  // Decay Discover ranking so the feed does not become a list of whoever
  // published most recently
  schedule
    .job('RerankDiscover')
    .hourly()
    .withoutOverlapping(10)

  // Mirror new direct messages into the inbox
  schedule
    .job('SyncDirectMessages')
    .everyFiveMinutes()
    .withoutOverlapping(5)

  // Run a custom action every five minutes
  // schedule.action('CleanupTempFiles').everyFiveMinutes()

  // Run a shell command daily at midnight
  // schedule.command('echo "Daily maintenance complete"').daily()
}

process.on('SIGINT', () => {
  schedule.gracefulShutdown().then(() => process.exit(0))
})
