import { Action } from '@stacksjs/actions'
import { db } from '@stacksjs/database'
import { response } from '@stacksjs/router'
import { workspace } from '../../Services/WorkspaceService'
import { actionFailure } from '../../Support/Http/action-error'

const database = db as any

/**
 * What the Mac app's menu-bar item shows (#195): whether scheduled publishing
 * is paused, when the next scheduled post goes out, and how many alerts are
 * unread. One small read, polled once a minute.
 */
export default new Action({
  name: 'Postline Desktop Status',
  description: 'Paused or not, the next scheduled post, and unread alerts, for the menu-bar item.',
  method: 'GET',

  async handle() {
    try {
      const next = await database.selectFrom('posts').select(['scheduled_at']).where('status', '=', 'scheduled').where('scheduled_at', 'is not', null).orderBy('scheduled_at', 'asc').limit(1).executeTakeFirst()
      const unread = await database.selectFrom('alerts').select(['id']).where('read_at', 'is', null).execute()
      return response.json({
        ok: true,
        data: {
          paused: (await workspace.profile()).publishingPaused,
          nextPostAt: next?.scheduled_at ? `${String(next.scheduled_at).replace(' ', 'T')}Z` : null,
          unread: unread.length,
        },
      })
    }
    catch (error) {
      return actionFailure(error)
    }
  },
})
