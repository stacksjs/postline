import { Action } from '@stacksjs/actions'
import { config } from '@stacksjs/config'
import { response } from '@stacksjs/router'
import { alertDeliverySettings, mailIsSetUp } from '../../Services/AlertService'
import { workspace } from '../../Services/WorkspaceService'
import { actionFailure } from '../../Support/Http/action-error'
import { readHeartbeats, schedulerState } from '../../Support/heartbeat'

export default new Action({
  name: 'Postline System Status',
  description: 'Whether the scheduler is running, when each recurring job last ran, and whether mail is set up.',
  method: 'GET',

  async handle() {
    try {
      const jobs = await readHeartbeats()
      // With no mailer the driver is `log`: a "sent" email only reaches the
      // log. Said plainly in Settings rather than reported as sent (#213).
      const driver = String(config.email?.default || 'log')
      const mail = { configured: mailIsSetUp(driver), driver, from: String(config.email?.from?.address || '') }
      // Paused by the owner (#195) is its own state: the scheduler runs, and holds.
      const paused = (await workspace.profile()).publishingPaused
      return response.json({ ok: true, data: { scheduler: schedulerState(jobs), jobs, mail, alerts: alertDeliverySettings(), paused } })
    }
    catch (error) {
      return actionFailure(error, 500)
    }
  },
})
