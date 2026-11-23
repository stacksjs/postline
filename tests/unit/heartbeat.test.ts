import { describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { PULSE_JOB, readHeartbeats, schedulerState, STALE_AFTER_SECONDS, withHeartbeat } from '../../app/Support/heartbeat'

const database = db as any
const NOW = Date.UTC(2026, 10, 22, 12, 0, 0)
const beat = (job: string, secondsAgo: number | null) => ({
  job,
  lastStartedAt: secondsAgo === null ? null : new Date(NOW - secondsAgo * 1000).toISOString(),
  lastFinishedAt: null,
  lastDurationMs: null,
  lastStatus: 'ok' as const,
  lastError: null,
  runs: 1,
})

describe('whether the scheduler is alive', () => {
  test('a publish run in the last two intervals means it is', () => {
    expect(schedulerState([beat(PULSE_JOB, 30)], NOW).state).toBe('ok')
    expect(schedulerState([beat(PULSE_JOB, STALE_AFTER_SECONDS)], NOW).state).toBe('ok')
  })

  test('stopping it turns stale within two intervals', () => {
    expect(schedulerState([beat(PULSE_JOB, STALE_AFTER_SECONDS + 1)], NOW).state).toBe('stale')
    expect(STALE_AFTER_SECONDS).toBeLessThanOrEqual(180)
  })

  test('another job running does not vouch for the scheduler', () => {
    expect(schedulerState([beat('SyncDirectMessages', 5)], NOW).state).toBe('never')
    expect(schedulerState([], NOW)).toEqual({ state: 'never', lastRunAt: null })
  })
})

describe('recording a job run', () => {
  test('a run records its start, finish, duration and result', async () => {
    await database.deleteFrom('job_heartbeats').where('job', '=', 'TestJob').execute()

    expect(await withHeartbeat('TestJob', async () => 'done')).toBe('done')
    await withHeartbeat('TestJob', async () => 'again')

    const row = (await readHeartbeats()).find(entry => entry.job === 'TestJob')!
    expect(row.lastStatus).toBe('ok')
    expect(row.runs).toBe(2)
    expect(row.lastStartedAt).toMatch(/Z$/)
    expect(row.lastFinishedAt).toMatch(/Z$/)
    expect(row.lastDurationMs).toBeGreaterThanOrEqual(0)
    await database.deleteFrom('job_heartbeats').where('job', '=', 'TestJob').execute()
  })

  test('a job that throws is recorded as failed and still throws', async () => {
    await database.deleteFrom('job_heartbeats').where('job', '=', 'TestJob').execute()

    await expect(withHeartbeat('TestJob', async () => { throw new Error('the network is down') })).rejects.toThrow('the network is down')

    const row = (await readHeartbeats()).find(entry => entry.job === 'TestJob')!
    expect(row.lastStatus).toBe('failed')
    expect(row.lastError).toBe('the network is down')
    await database.deleteFrom('job_heartbeats').where('job', '=', 'TestJob').execute()
  })
})
