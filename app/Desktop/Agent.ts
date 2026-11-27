import type { WebviewAgentModule } from '@stacksjs/desktop-build'
import type { Schedule } from './schedule'
import process from 'node:process'
import { finishWorkspacePreparation } from './Prepare'

let schedule: Schedule | undefined

export default {
  async start() {
    // Stacks owns auth tables separately from its numbered migrations.
    // The desktop owner does not log in, but network OAuth uses those tables.
    const { migrateAuthTables } = await import('@stacksjs/database/auth-tables')
    const auth = await migrateAuthTables()
    if (!auth.success) throw new Error(auth.error ?? 'Could not initialize the authentication tables.')

    // Stacks prepares the workspace and finishes all database migrations
    // before starting the agent. An older build can still read app.key if
    // the database upgrade fails.
    finishWorkspacePreparation()

    const [
      { startSchedule }, { readHeartbeats },
      { default: publishScheduledPosts }, { default: syncEngagementMetrics },
      { default: scanKeywordMonitors }, { default: importDraftFeeds },
      { default: syncDirectMessages }, { default: autoDeletePosts },
      { default: keepTokensAlive }, { default: pruneLocalData },
    ] = await Promise.all([
      import('./schedule'),
      import('../Support/heartbeat'),
      import('../Jobs/PublishScheduledPosts.ts'),
      import('../Jobs/SyncEngagementMetrics.ts'),
      import('../Jobs/ScanKeywordMonitors.ts'),
      import('../Jobs/ImportDraftFeeds.ts'),
      import('../Jobs/SyncDirectMessages.ts'),
      import('../Jobs/AutoDeletePosts.ts'),
      import('../Jobs/KeepTokensAlive.ts'),
      import('../Jobs/PruneLocalData.ts'),
    ])

    schedule = startSchedule({
      publishScheduledPosts, syncEngagementMetrics, scanKeywordMonitors, importDraftFeeds,
      syncDirectMessages, autoDeletePosts, keepTokensAlive, pruneLocalData,
    }, {
      say: line => console.error(line),
      // Resume overdue jobs when the app opens.
      lastRuns: async () => Object.fromEntries((await readHeartbeats()).map(beat => [beat.job, beat.lastStartedAt])),
    })
  },

  fetch(request) {
    const { pathname } = new URL(request.url)
    if (pathname === '/' || pathname === '/login')
      return Response.redirect(new URL('/composer', request.url).toString(), 302)
  },

  async beforeInstall() {
    try {
      const database = process.env.DB_DATABASE_PATH
      if (!database) throw new Error('The workspace database path is missing.')
      const { backupBeforeDesktopUpdate } = await import('./update-backup')
      const backup = backupBeforeDesktopUpdate(database)
      console.log(`[postline] saved pre-update workspace database to ${backup}`)
    }
    catch (error) {
      console.error('[postline] pre-update workspace backup failed', error)
      throw new Error('Postline could not back up its workspace database. Check that the workspace is available and has free space, then try again.', { cause: error })
    }
  },

  stop() {
    schedule?.stop()
  },
} satisfies WebviewAgentModule
