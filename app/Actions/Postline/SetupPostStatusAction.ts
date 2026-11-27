import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { postQueue } from '../../Services/Social/QueueService'

export default new Action({
  name: 'Postline Setup Post Status',
  description: 'Check the saved status of the first post created during setup.',
  method: 'GET',

  async handle(request: RequestInstance) {
    const id = Number(request.get('id'))
    const headers = { 'Cache-Control': 'private, no-store' }
    if (!Number.isSafeInteger(id) || id < 1)
      return response.json({ ok: false, error: 'A valid post id is required.' }, { status: 422, headers })

    const status = await postQueue.status(id)
    if (status === null)
      return response.json({ ok: false, error: 'Post not found.' }, { status: 404, headers })

    return response.json({ ok: true, data: { status } }, { headers })
  },
})
