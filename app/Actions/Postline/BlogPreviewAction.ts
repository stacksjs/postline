import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { renderSafeMarkdown } from '@stacksjs/cms/markdown'
import { response } from '@stacksjs/router'

export default new Action({
  name: 'Postline Blog Preview',
  description: 'Render draft Markdown the same way as a published Blog post.',
  method: 'POST',

  async handle(request: RequestInstance) {
    const bodies = request.get('bodies')
    if (!Array.isArray(bodies) || bodies.some(body => typeof body !== 'string')
      || bodies.length > 32 || bodies.reduce((total, body) => total + body.length, 0) > 64_000)
      return response.json({ ok: false, error: 'Too much text to render in a preview.' }, { status: 422 })

    const html = bodies.map(body => renderSafeMarkdown(body, { headingIds: false }))
    return response.json({ ok: true, data: { html } }, { headers: { 'Cache-Control': 'private, no-store' } })
  },
})
