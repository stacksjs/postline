/**
 * The scheduled jobs (#113). Each is a thin wrapper around a service; what
 * they add is the heartbeat the health check reads, and one job's failure
 * staying its own.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import AutoDeletePosts from '../../app/Jobs/AutoDeletePosts'
import KeepTokensAlive from '../../app/Jobs/KeepTokensAlive'
import PruneLocalData from '../../app/Jobs/PruneLocalData'
import PublishScheduledPosts from '../../app/Jobs/PublishScheduledPosts'
import ScanKeywordMonitors from '../../app/Jobs/ScanKeywordMonitors'
import SyncDirectMessages from '../../app/Jobs/SyncDirectMessages'
import { directMessages } from '../../app/Services/DirectMessageService'
import { housekeeping } from '../../app/Services/HousekeepingService'
import { keywordMonitoring } from '../../app/Services/KeywordMonitoringService'
import { retention } from '../../app/Services/RetentionService'
import { linkedin } from '../../app/Services/Social/LinkedInService'
import { postQueue } from '../../app/Services/Social/QueueService'
import { threads } from '../../app/Services/Social/ThreadsService'
import { twitter } from '../../app/Services/Social/TwitterService'
import { readHeartbeats } from '../../app/Support/heartbeat'

const database = db as any
type Runnable = { handle?: (...args: any[]) => Promise<unknown> }
const run = async (job: unknown): Promise<any> => await (job as Runnable).handle!()

/** Swap a method for the length of one test. */
const restores: Array<() => void> = []
function stub<T extends object, K extends keyof T>(target: T, key: K, value: T[K]): void {
  const original = target[key]
  target[key] = value
  restores.push(() => { target[key] = original })
}

afterEach(async () => {
  while (restores.length) restores.pop()!()
})

async function beat(job: string) {
  return (await readHeartbeats()).find(row => row.job === job)
}

describe('scheduled jobs', () => {
  test('publishing hands back what the queue did and records a heartbeat', async () => {
    await database.deleteFrom('job_heartbeats').where('job', '=', 'PublishScheduledPosts').execute()
    stub(postQueue, 'publishDue', (async () => ({ published: 2, failed: 1, missed: 3 })) as typeof postQueue.publishDue)

    expect(await run(PublishScheduledPosts)).toEqual({ published: 2, failed: 1, missed: 3 })
    const heartbeat = await beat('PublishScheduledPosts')
    expect(heartbeat?.lastStatus).toBe('ok')
    expect(heartbeat?.runs).toBe(1)
  })

  test('a failing run is recorded as failed, with its error, and still throws', async () => {
    stub(directMessages, 'sync', (async () => { throw new Error('network down') }) as typeof directMessages.sync)

    await expect(run(SyncDirectMessages)).rejects.toThrow('network down')
    const heartbeat = await beat('SyncDirectMessages')
    expect(heartbeat?.lastStatus).toBe('failed')
    expect(heartbeat?.lastError).toBe('network down')
  })

  test('one network failing to renew does not stop the others', async () => {
    stub(twitter, 'keepAlive', (async () => { throw new Error('revoked') }) as typeof twitter.keepAlive)
    stub(linkedin, 'keepAlive', (async () => 2) as typeof linkedin.keepAlive)
    stub(threads, 'keepAlive', (async () => 1) as typeof threads.keepAlive)

    expect(await run(KeepTokensAlive)).toEqual({ linkedin: 2, threads: 1 })
    expect((await beat('KeepTokensAlive'))?.lastStatus).toBe('ok')
  })

  test('automatic deletion that is off reports why it skipped', async () => {
    stub(retention, 'run', (async () => ({ ran: false, reason: 'off' })) as unknown as typeof retention.run)
    expect(await run(AutoDeletePosts)).toEqual({ skipped: 'off' })
  })

  test('listening and pruning return their services\' counts', async () => {
    stub(keywordMonitoring, 'scan', (async () => ({ scanned: 2, created: 5 })) as unknown as typeof keywordMonitoring.scan)
    stub(housekeeping, 'prune', (async () => ({ mentions: 3, timeline: 0 })) as unknown as typeof housekeeping.prune)

    expect(await run(ScanKeywordMonitors)).toEqual({ scanned: 2, created: 5 })
    expect(await run(PruneLocalData)).toEqual({ mentions: 3, timeline: 0 })
  })
})
