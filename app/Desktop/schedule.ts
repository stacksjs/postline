/**
 * The app's recurring work, run inside the desktop agent.
 *
 * On a server `app/Scheduler.ts` names each job by string and a scheduler
 * daemon loads it from `app/Jobs/`. The desktop app has no daemon and no job
 * files on disk, so the same jobs are imported here and run on timers for as
 * long as the app is open. That is also the honest schedule for a desktop app:
 * a queued post goes out while Postline is running.
 *
 * Intervals mirror `app/Scheduler.ts`. A job never overlaps itself: one that
 * is still running when its next turn comes skips that turn.
 */
interface Runnable {
  name: string
  handle?: (...args: any[]) => unknown
}

interface Entry {
  job: Runnable
  everyMs: number
}

const MINUTE = 60_000

export interface Schedule {
  stop: () => void
}

export function startSchedule(jobs: {
  publishScheduledPosts: Runnable
  syncEngagementMetrics: Runnable
  scanKeywordMonitors: Runnable
  syncDirectMessages: Runnable
  autoDeletePosts: Runnable
  keepTokensAlive: Runnable
  pruneLocalData: Runnable
}, options: {
  say?: (line: string) => void
  /**
   * When each job last started, by job name (ISO time), from the heartbeats
   * the jobs record. A job whose last run is older than its interval, or
   * that never ran, runs at launch.
   */
  lastRuns?: () => Promise<Record<string, string | null>>
  now?: () => number
} = {}): Schedule {
  const entries: Entry[] = [
    { job: jobs.publishScheduledPosts, everyMs: MINUTE },
    { job: jobs.scanKeywordMonitors, everyMs: 5 * MINUTE },
    { job: jobs.syncDirectMessages, everyMs: 5 * MINUTE },
    { job: jobs.syncEngagementMetrics, everyMs: 30 * MINUTE },
    { job: jobs.autoDeletePosts, everyMs: 24 * 60 * MINUTE },
    { job: jobs.keepTokensAlive, everyMs: 24 * 60 * MINUTE },
    { job: jobs.pruneLocalData, everyMs: 24 * 60 * MINUTE },
  ]

  const running = new Set<string>()
  const timers: Array<ReturnType<typeof setInterval>> = []

  const run = async (job: Runnable): Promise<void> => {
    if (running.has(job.name) || typeof job.handle !== 'function') return
    running.add(job.name)
    try {
      await job.handle()
    }
    catch (error) {
      // A job that fails must not take the app down, or stop the next run.
      options.say?.(`[schedule] ${job.name} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    finally {
      running.delete(job.name)
    }
  }

  for (const entry of entries)
    timers.push(setInterval(() => void run(entry.job), entry.everyMs))

  // Posts that came due while the app was closed are dealt with now, not in a
  // minute: a recent one goes out, and one older than the grace window is
  // held back for the owner to decide on.
  void run(jobs.publishScheduledPosts)

  // A desktop app is rarely open for a whole day, so a daily timer alone
  // would never fire. Every other job that is overdue (its last run older
  // than its interval, or none recorded) runs now (#197). Without a record of
  // last runs, the daily jobs run, as they always did for tokens.
  void (async () => {
    const now = options.now?.() ?? Date.now()
    let lastRuns: Record<string, string | null> | null = null
    try {
      lastRuns = await options.lastRuns?.() ?? null
    }
    catch {}
    for (const entry of entries) {
      if (entry.job === jobs.publishScheduledPosts) continue
      if (isOverdue(entry, lastRuns, now)) void run(entry.job)
    }
  })()

  return { stop: () => timers.forEach(timer => clearInterval(timer)) }
}

/** Whether a job should run at launch: it never ran, or its last run is older than its interval. */
export function isOverdue(entry: Entry, lastRuns: Record<string, string | null> | null, now: number): boolean {
  if (!lastRuns) return entry.everyMs >= 24 * 60 * MINUTE
  const last = lastRuns[entry.job.name]
  if (!last) return true
  const at = Date.parse(last)
  return Number.isNaN(at) || now - at >= entry.everyMs
}
