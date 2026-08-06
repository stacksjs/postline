import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { mailConfigured, newsletter } from '../../Services/NewsletterService'

export default new Action({
  name: 'The Open Times Sends List',
  description: 'List newsletter sends and their delivery progress.',
  method: 'GET',

  async handle() {
    try {
      return response.json({
        ok: true,
        data: { sends: await newsletter.list(), configured: mailConfigured() },
      })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
