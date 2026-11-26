/**
 * The health check covers the scheduler, the disk and the schema (#210).
 */
import { describe, expect, test } from 'bun:test'
import { featureTest } from '@stacksjs/testing'
import { freeBytes, LOW_DISK_BYTES } from '../../app/Actions/Postline/HealthAction'

describe('health', () => {
  test('reports the scheduler, the disk and the migrations', async () => {
    const response = await featureTest().get('/api/postline/health')
    const body = await response.json() as { disk: string, migrations: string } & Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['database', 'disk', 'migrations', 'ok', 'scheduler'])
    expect(['ok', 'low', 'unknown']).toContain(body.disk)
    expect(['ok', 'pending']).toContain(body.migrations)
    // The suite's database is migrated: only the scheduler can make it unhealthy here.
    expect(body.migrations).toBe('ok')
  })

  test('free space is read where the database lives', () => {
    const free = freeBytes(process.env.DB_DATABASE_PATH)
    expect(free).not.toBeNull()
    expect(LOW_DISK_BYTES).toBe(512 * 1024 * 1024)
  })
})
