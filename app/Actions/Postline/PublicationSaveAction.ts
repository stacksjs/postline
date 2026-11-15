import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { publications } from '../../Services/PublicationService'

export default new Action({
  name: 'Postline Publication Save',
  description: 'Update the publication, including its Discover listing opt-in.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      const publication = await publications.save({
        name: request.get('name'),
        tagline: request.get('tagline'),
        description: request.get('description'),
        domain: request.get('domain'),
        authorName: request.get('author_name'),
        listed: request.get('listed'),
      })

      return response.json({ ok: true, data: { publication } })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
