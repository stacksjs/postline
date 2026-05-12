import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'

export default new Action({
  name: 'NotifyUser',
  description: 'Notify User After Creation',

  async handle(request: RequestInstance) {
    const id = request.get('id')
    const name = request.get('name')

    console.log(`[NotifyUser] User created:`, { id, name })

    return { success: true }
  },
})
