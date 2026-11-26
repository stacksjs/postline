/**
 * "Show in Finder" for the Mac app's log (#202) answers only inside the app.
 */
import { describe, expect, test } from 'bun:test'
import DesktopRevealLogAction from '../../app/Actions/Postline/DesktopRevealLogAction'

const handle = (DesktopRevealLogAction as unknown as { handle: () => Promise<Response> }).handle

describe('revealing the Mac app\'s log', () => {
  test('a server refuses: there is no Finder and the log is the host\'s', async () => {
    const before = process.env.POSTLINE_DESKTOP_AGENT
    delete process.env.POSTLINE_DESKTOP_AGENT
    try {
      expect((await handle()).status).toBe(404)
    }
    finally {
      if (before !== undefined) process.env.POSTLINE_DESKTOP_AGENT = before
    }
  })
})
