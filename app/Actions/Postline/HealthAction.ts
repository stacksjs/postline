import process from 'node:process'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { readHeartbeats, schedulerState } from '../../Support/heartbeat'

/** A scheduler that has never run is given this long after the server starts. */
const STARTUP_GRACE_SECONDS = 180

/**
 * A health check that knows about the scheduler. The framework's own check
 * looks at the database and the cache; with only that, a workspace whose
 * scheduler has died reports healthy while every scheduled post sits unsent.
 *
 * Public, because a load balancer or uptime monitor calls it without a
 * session. It says nothing about the workspace beyond these states.
 */
export default new Action({
  name: 'Postline Health',
  description: 'Reports whether the app can reach its database and its scheduler is running.',
  method: 'GET',

  async handle() {
    try {
      const { state } = schedulerState(await readHeartbeats())
      const starting = state === 'never' && process.uptime() < STARTUP_GRACE_SECONDS
      const healthy = state === 'ok' || starting
      return response.json({ ok: healthy, database: 'ok', scheduler: starting ? 'starting' : state }, { status: healthy ? 200 : 503 })
    }
    catch {
      return response.json({ ok: false, database: 'unreachable', scheduler: 'unknown' }, { status: 503 })
    }
  },
})
