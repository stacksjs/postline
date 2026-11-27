import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { isDesktopAgent } from '../../Support/Auth/native'
import { workspaceHasOwner } from '../../Support/Http/workspace-owner'
import { isMarketingSite } from '../../Support/Marketing/site'

export default new Action({
  name: 'Postline Setup Availability',
  description: 'Tell the setup page whether this install can create a workspace owner.',
  method: 'GET',

  async handle() {
    const available = !isMarketingSite() && !isDesktopAgent() && !await workspaceHasOwner()
    return response.json({ ok: true, data: { available } }, { headers: { 'Cache-Control': 'no-store' } })
  },
})
