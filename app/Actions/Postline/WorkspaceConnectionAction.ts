import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { isDesktopAgent } from '../../Support/Auth/native'
import { isMarketingSite } from '../../Support/Marketing/site'

export default new Action({
  name: 'Postline Workspace Connection',
  description: 'Identify a server workspace before a mobile client opens sign-in.',
  method: 'GET',

  async handle() {
    const headers = { 'Cache-Control': 'no-store' }
    if (isMarketingSite() || isDesktopAgent())
      return response.json({ message: 'Not Found' }, { status: 404, headers })

    // This is a protocol identifier, independent of setup or login state.
    return response.json({ product: 'postline', protocol: 1 }, { headers })
  },
})
