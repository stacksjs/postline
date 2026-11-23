import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { actionFailure } from '../../Support/Http/action-error'
import { readHeartbeats, schedulerState } from '../../Support/heartbeat'

export default new Action({
  name: 'Postline System Status',
  description: 'Whether the scheduler is running, and when each recurring job last ran.',
  method: 'GET',

  async handle() {
    try {
      const jobs = await readHeartbeats()
      return response.json({ ok: true, data: { scheduler: schedulerState(jobs), jobs } })
    }
    catch (error) {
      return actionFailure(error, 500)
    }
  },
})
