import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { composerPresets } from '../../Services/ComposerPresetService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Composer Preset Save',
  description: 'Create or edit saved Composer text.',
  method: 'POST',

  async handle(request) {
    try {
      const data = await composerPresets.save(request.get('uuid'), {
        kind: request.get('kind'),
        name: request.get('name'),
        body: request.get('body'),
      })
      return response.json({ ok: true, data })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
