import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { postQueue } from '../../Services/Social/QueueService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Queue Preview Video',
  description: 'Play the saved video while editing a queued post.',
  method: 'GET',

  async handle(request: RequestInstance) {
    const id = Number(request.get('id'))
    if (!Number.isSafeInteger(id) || id < 1)
      return response.json({ ok: false, error: 'A valid post id is required.' }, { status: 422 })

    try {
      const video = await postQueue.previewVideo(id, request.headers.get('range'))
      return video ?? response.json({ ok: false, error: 'Video not found.' }, { status: 404 })
    }
    catch (error) {
      return actionFailure(error, 404)
    }
  },
})
