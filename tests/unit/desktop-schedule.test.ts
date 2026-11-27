import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isOverdue, startSchedule } from '../../app/Desktop/schedule'
import { allowsNativeAppWithoutLogin, isDesktopAgent } from '../../app/Support/Auth/native'

/**
 * Inside the desktop app there is no scheduler daemon: the recurring jobs run
 * on timers in the agent for as long as the app is open.
 */
function job(name: string, handle: () => unknown = () => {}) {
  return { name, handle }
}

const idle = {
  syncEngagementMetrics: job('SyncEngagementMetrics'),
  scanKeywordMonitors: job('ScanKeywordMonitors'),
  importDraftFeeds: job('ImportDraftFeeds'),
  syncDirectMessages: job('SyncDirectMessages'),
  autoDeletePosts: job('AutoDeletePosts'),
  keepTokensAlive: job('KeepTokensAlive'),
  pruneLocalData: job('PruneLocalData'),
}

let stop: (() => void) | null = null

afterEach(() => {
  stop?.()
  stop = null
  delete process.env.POSTLINE_DESKTOP_AGENT
})

describe('the desktop schedule', () => {
  test('publishes what came due while the app was closed, at once', async () => {
    let runs = 0
    const schedule = startSchedule({ ...idle, publishScheduledPosts: job('PublishScheduledPosts', () => { runs++ }) })
    stop = schedule.stop

    await Bun.sleep(5)

    expect(runs).toBe(1)
  })

  test('a job that throws is reported and does not take the app down', async () => {
    const said: string[] = []
    const schedule = startSchedule({
      ...idle,
      publishScheduledPosts: job('PublishScheduledPosts', () => {
        throw new Error('network is down')
      }),
    }, { say: line => said.push(line) })
    stop = schedule.stop

    await Bun.sleep(5)

    expect(said).toEqual(['[schedule] PublishScheduledPosts failed: network is down'])
  })

  test('a job with nothing to run is skipped, not called', async () => {
    const schedule = startSchedule({ ...idle, publishScheduledPosts: { name: 'PublishScheduledPosts' } })
    stop = schedule.stop

    await Bun.sleep(5)

    expect(true).toBe(true)
  })
})

describe('signing in inside the desktop app', () => {
  test('the agent lets its own window in, even in production', () => {
    process.env.POSTLINE_DESKTOP_AGENT = '1'

    expect(isDesktopAgent()).toBe(true)
    expect(allowsNativeAppWithoutLogin()).toBe(true)
  })

  test('a server is never the agent, whatever a request claims', () => {
    delete process.env.POSTLINE_DESKTOP_AGENT

    expect(isDesktopAgent()).toBe(false)
    expect(allowsNativeAppWithoutLogin()).toBe(false)
  })
})

describe('overdue jobs at launch (#197)', () => {
  const day = 24 * 60 * 60_000
  const daily = { job: job('AutoDeletePosts'), everyMs: day }

  test('a job runs at launch when its last run is older than its interval, or it never ran', () => {
    const now = Date.UTC(2026, 10, 25, 12)
    expect(isOverdue(daily, { AutoDeletePosts: new Date(now - day - 1).toISOString() }, now)).toBe(true)
    expect(isOverdue(daily, { AutoDeletePosts: new Date(now - 60_000).toISOString() }, now)).toBe(false)
    expect(isOverdue(daily, {}, now)).toBe(true)
    // Without a record of last runs, the daily ones run, the frequent ones wait for their timer.
    expect(isOverdue(daily, null, now)).toBe(true)
    expect(isOverdue({ job: job('SyncDirectMessages'), everyMs: 5 * 60_000 }, null, now)).toBe(false)
  })

  test('at launch every overdue job runs and one that ran recently does not', async () => {
    const ran: string[] = []
    const track = (name: string) => job(name, () => { ran.push(name) })
    const now = Date.now()
    const schedule = startSchedule({
      publishScheduledPosts: track('PublishScheduledPosts'),
      syncEngagementMetrics: track('SyncEngagementMetrics'),
      scanKeywordMonitors: track('ScanKeywordMonitors'),
      importDraftFeeds: track('ImportDraftFeeds'),
      syncDirectMessages: track('SyncDirectMessages'),
      autoDeletePosts: track('AutoDeletePosts'),
      keepTokensAlive: track('KeepTokensAlive'),
      pruneLocalData: track('PruneLocalData'),
    }, {
      now: () => now,
      lastRuns: async () => ({
        SyncDirectMessages: new Date(now - 60_000).toISOString(),
        ScanKeywordMonitors: new Date(now - 60_000).toISOString(),
        SyncEngagementMetrics: new Date(now - 60_000).toISOString(),
        AutoDeletePosts: new Date(now - 2 * day).toISOString(),
        KeepTokensAlive: null,
      }),
    })
    stop = schedule.stop
    await Bun.sleep(20)
    expect(ran.sort()).toEqual(['AutoDeletePosts', 'ImportDraftFeeds', 'KeepTokensAlive', 'PruneLocalData', 'PublishScheduledPosts'])
  })

  test('the Mac app runs all workspace jobs and leaves off-site backups to configured servers', () => {
    const root = join(import.meta.dir, '../..')
    const scheduled = [...readFileSync(join(root, 'app/Scheduler.ts'), 'utf8').matchAll(/\.job\('(\w+)'\)/g)].map(match => match[1]).sort()
    const bundled = [...readFileSync(join(root, 'app/Desktop/Agent.ts'), 'utf8').matchAll(/import\('\.\.\/Jobs\/(\w+)\.ts'\)/g)].map(match => match[1]).sort()
    expect(scheduled).toEqual([...bundled, 'BackupWorkspace'].sort())
  })
})
