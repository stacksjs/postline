import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { composerPresets } from '../../Services/ComposerPresetService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Composer Preset List',
  description: 'List saved snippets, templates, and hashtag sets.',
  method: 'GET',

  async handle() {
    try {
      return response.json({ ok: true, data: await composerPresets.list() })
    }
    catch (error) {
      return actionFailure(error, 500)
    }
  },
})
