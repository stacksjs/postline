import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { composerPresets } from '../../Services/ComposerPresetService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Composer Preset Delete',
  description: 'Remove saved Composer text from this workspace.',
  method: 'POST',

  async handle(request) {
    try {
      await composerPresets.remove(request.get('uuid'))
      return response.json({ ok: true })
    }
    catch (error) {
      return actionFailure(error, 422)
    }
  },
})
