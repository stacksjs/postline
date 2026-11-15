import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { blog } from '../../Services/Social/BlogService'

export default new Action({
  name: 'Postline Blog List',
  description: 'List published blog posts.',
  method: 'GET',

  async handle() {
    try {
      const items = await blog.list()
      return response.json({ ok: true, data: { items } })
    }
    catch (error) {
      return response.json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }, { status: 500 })
    }
  },
})
