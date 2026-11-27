import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { postQueue } from '../../Services/Social/QueueService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Queue Preview Image',
  description: 'Show an existing attachment while editing a queued post.',
  method: 'GET',

  async handle(request: RequestInstance) {
    const id = Number(request.get('id'))
    const index = Number(request.get('index'))
    if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(index) || index < 0)
      return response.json({ ok: false, error: 'A valid post id and image index are required.' }, { status: 422 })

    try {
      const image = await postQueue.previewImage(id, index)
      return image ?? response.json({ ok: false, error: 'Image not found.' }, { status: 404 })
    }
    catch (error) {
      return actionFailure(error, 404)
    }
  },
})
