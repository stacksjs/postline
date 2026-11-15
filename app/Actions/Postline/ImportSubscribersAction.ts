import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { imports } from '../../Services/ImportService'

export default new Action({
  name: 'Postline Import Subscribers',
  description: 'Import a reader list from a CSV export.',
  method: 'POST',

  async handle(request: RequestInstance) {
    try {
      const csv = String(request.get('csv') || '')
      if (!csv.trim()) throw new Error('Paste or upload a CSV export first.')

      return response.json({ ok: true, data: { report: await imports.importSubscriberCsv(csv) } })
    }
    catch (error) {
      return response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 })
    }
  },
})
