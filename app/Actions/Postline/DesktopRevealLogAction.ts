import { Action } from '@stacksjs/actions'
import { desktopAppPaths } from '@stacksjs/desktop-build/webview-agent'
import { response } from '@stacksjs/router'
import { isDesktopAgent } from '../../Support/Auth/native'

/**
 * Show the Mac app's log in Finder (#202), for a bug report. Only the desktop
 * agent answers: on a server there is no Finder, and the log is the host's.
 * The command and the path are fixed; nothing from the request reaches them.
 */
export default new Action({
  name: 'Postline Desktop Reveal Log',
  description: 'Select the Mac app\'s log file in Finder.',
  method: 'POST',

  async handle() {
    if (!isDesktopAgent() || process.platform !== 'darwin')
      return response.json({ ok: false, error: 'Only the Mac app has a log to show.' }, { status: 404 })
    const { logFile } = desktopAppPaths('Postline')
    Bun.spawn(['/usr/bin/open', '-R', logFile], { stdout: 'ignore', stderr: 'ignore' })
    return response.json({ ok: true, data: { path: logFile } })
  },
})
