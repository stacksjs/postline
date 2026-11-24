import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { blog } from '../../Services/Social/BlogService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Blog Delete',
  description: 'Delete a blog post and its page for good.',
  method: 'POST',

  async handle(request: RequestInstance) {
    const id = Number(request.get('id') || 0)
    if (!id)
      return response.json({ ok: false, error: 'Blog post id is required.' }, { status: 422 })
    try {
      await blog.remove(id)
      return response.json({ ok: true })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
