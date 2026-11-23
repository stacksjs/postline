/**
 * A heartbeat for each recurring job.
 *
 * When the scheduler stops, nothing fails: posts stay "scheduled" and the app
 * looks the same. The only evidence is that a job which runs every minute has
 * not run. Each job therefore records when it started and finished, and the
 * queue and the health check read that.
 *
 * Recording is never allowed to break the job it wraps: a database that is
 * briefly locked must not stop a post going out.
 */
import { db } from '@stacksjs/database'
import { log } from '@stacksjs/logging'

const database = db as any

/** The job the scheduler's health is judged by: it runs every minute. */
export const PULSE_JOB = 'PublishScheduledPosts'
/** Two missed runs, with slack for a slow one. */
export const STALE_AFTER_SECONDS = 150

export type SchedulerState = 'ok' | 'stale' | 'never'

export interface Heartbeat {
  job: string
  lastStartedAt: string | null
  lastFinishedAt: string | null
  lastDurationMs: number | null
  lastStatus: 'running' | 'ok' | 'failed' | null
  lastError: string | null
  runs: number
}

function stamp(ms: number = Date.now()): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
}

function toIso(value: unknown): string | null {
  return value ? `${String(value).replace(' ', 'T')}Z` : null
}

async function record(job: string, values: Record<string, unknown>, started: boolean): Promise<void> {
  try {
    const existing = await database.selectFrom('job_heartbeats').select(['id', 'runs']).where('job', '=', job).executeTakeFirst()
    if (existing) {
      await database.updateTable('job_heartbeats')
        .set({ ...values, ...(started ? { runs: Number(existing.runs || 0) + 1 } : {}), updated_at: stamp() })
        .where('id', '=', existing.id)
        .execute()
      return
    }
    await database.insertInto('job_heartbeats').values({ job, runs: 1, ...values, created_at: stamp(), updated_at: stamp() }).execute()
  }
  catch (error) {
    log.warn(`[postline] could not record the heartbeat for ${job}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Run a job's work and record that it ran, how long it took and how it ended. */
export async function withHeartbeat<T>(job: string, work: () => Promise<T>): Promise<T> {
  const startedMs = Date.now()
  await record(job, { last_started_at: stamp(startedMs), last_status: 'running' }, true)
  try {
    const result = await work()
    await record(job, { last_finished_at: stamp(), last_duration_ms: Date.now() - startedMs, last_status: 'ok', last_error: null }, false)
    return result
  }
  catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000)
    await record(job, { last_finished_at: stamp(), last_duration_ms: Date.now() - startedMs, last_status: 'failed', last_error: message }, false)
    throw error
  }
}

export async function readHeartbeats(): Promise<Heartbeat[]> {
  const rows = await database.selectFrom('job_heartbeats').selectAll().orderBy('job', 'asc').execute()
  return rows.map((row: any): Heartbeat => ({
    job: String(row.job),
    lastStartedAt: toIso(row.last_started_at),
    lastFinishedAt: toIso(row.last_finished_at),
    lastDurationMs: row.last_duration_ms === null || row.last_duration_ms === undefined ? null : Number(row.last_duration_ms),
    lastStatus: row.last_status || null,
    lastError: row.last_error || null,
    runs: Number(row.runs || 0),
  }))
}

/**
 * Whether the scheduler is alive, from the heartbeats alone. `never` is a
 * workspace whose scheduler has not run once: a fresh install, or one where
 * it was never started.
 */
export function schedulerState(beats: readonly Heartbeat[], nowMs: number = Date.now()): { state: SchedulerState, lastRunAt: string | null } {
  const pulse = beats.find(beat => beat.job === PULSE_JOB)
  const lastRunAt = pulse?.lastStartedAt ?? null
  if (!lastRunAt) return { state: 'never', lastRunAt: null }
  const age = (nowMs - Date.parse(lastRunAt)) / 1000
  return { state: age <= STALE_AFTER_SECONDS ? 'ok' : 'stale', lastRunAt }
}
