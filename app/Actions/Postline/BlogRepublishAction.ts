import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { workspaceBlogErrors } from '../../Support/Localization/workspace'
import { blog } from '../../Services/Social/BlogService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Blog Republish',
  description: 'Put a taken-down blog post back on the site.',
  method: 'POST',

  async handle(request: RequestInstance) {
    const id = Number(request.get('id') || 0)
    if (!id)
      return response.json({ ok: false, error: workspaceBlogErrors.idRequired }, { status: 422 })
    try {
      const data = await blog.republish(id)
      return response.json({ ok: true, data })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
