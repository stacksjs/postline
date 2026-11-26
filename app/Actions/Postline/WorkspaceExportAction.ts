import { Action } from '@stacksjs/actions'
import { workspaceArchive } from '../../Services/WorkspaceArchiveService'
import { actionFailure } from '../../Support/Http/action-error'

export default new Action({
  name: 'Postline Workspace Export',
  description: 'Download the workspace as one JSON file: posts, campaigns, blog, Listening, settings and queued images. No sign-ins or keys.',
  method: 'GET',

  async handle() {
    try {
      const archive = await workspaceArchive.export()
      const day = archive.exportedAt.slice(0, 10)
      return new Response(JSON.stringify(archive), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename="postline-workspace-${day}.json"`,
          'cache-control': 'no-store',
        },
      })
    }
    catch (error) {
      return actionFailure(error, 500)
    }
  },
})
