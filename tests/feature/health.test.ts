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
    // `request_id` is the framework's correlation id, on every JSON response.
    expect(Object.keys(body).filter(key => key !== 'request_id').sort()).toEqual(['database', 'disk', 'migrations', 'ok', 'scheduler'])
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

describe('system status', () => {
  test('reports mail and alert delivery settings without revealing the webhook', async () => {
    const { featureTest } = await import('@stacksjs/testing')
    const User = (await import('../../storage/framework/defaults/app/Models/User')).default
    const user = await User.first() ?? await User.create({ name: 'Mail Test', email: `mail-${Date.now()}@postline.test`, password: 'unused-acting-as' })
    const response = await featureTest().actingAs(user as unknown as { id: number }).get('/api/postline/system')
    const body = await response.json() as { data: { mail: { configured: boolean, driver: string }, alerts: { email: boolean, webhook: boolean } } }
    const email = body.data.mail.configured && String(process.env.POSTLINE_ALERT_EMAIL || '').trim().toLowerCase() !== 'off'
    const webhook = Boolean(String(process.env.POSTLINE_ALERT_WEBHOOK_URL || '').trim())
    expect(body.data.alerts).toEqual({ email, webhook })
    expect(typeof body.data.mail.configured).toBe('boolean')
    expect(body.data.mail.configured).toBe(!['log', 'capture'].includes(body.data.mail.driver))
  })
})
