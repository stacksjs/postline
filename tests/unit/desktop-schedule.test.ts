import { afterEach, describe, expect, test } from 'bun:test'
import { startSchedule } from '../../app/Desktop/schedule'
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
  syncDirectMessages: job('SyncDirectMessages'),
  autoDeletePosts: job('AutoDeletePosts'),
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
  const browser = { get: (name: string) => (name === 'host' ? 'postline.example.com' : null) }

  test('the agent lets its own window in, even in production', () => {
    process.env.POSTLINE_DESKTOP_AGENT = '1'

    expect(isDesktopAgent()).toBe(true)
    expect(allowsNativeAppWithoutLogin(browser, 'production')).toBe(true)
  })

  test('a server is never the agent, whatever a request claims', () => {
    const claiming = { get: (name: string) => ({ 'host': 'postline.example.com', 'x-postline-native': 'craft', 'x-postline-desktop-agent': '1' } as Record<string, string>)[name] ?? null }

    expect(isDesktopAgent()).toBe(false)
    expect(allowsNativeAppWithoutLogin(claiming, 'production')).toBe(false)
  })
})
