import type { RequestInstance } from '@stacksjs/types'
import { createHash } from 'node:crypto'
import { Action } from '@stacksjs/actions'
import { response } from '@stacksjs/router'
import { crosspostProviders } from '../../Services/Social/CrosspostService'
import { postQueue } from '../../Services/Social/QueueService'
import { actionFailure } from '../../Support/Http/action-error'
import { UserFacingError } from '../../Support/Http/user-error'
import { isAccountProvider, parseTarget, targetKey } from '../../Support/Social/targets'

const fields = new Set(['text', 'title', 'providers', 'scheduledAt'])

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function readSubmission(body: unknown) {
  if (typeof body !== 'object' || !body || Array.isArray(body) || Object.keys(body).some(key => !fields.has(key)))
    throw new UserFacingError('Send a JSON object with text, providers, and optional title and scheduledAt.')
  const { text, title, providers, scheduledAt } = body as Record<string, unknown>
  if (typeof text !== 'string' || !text.trim() || text.trim().length > 4000)
    throw new UserFacingError('Post text must be 1 to 4000 characters.')
  if (title !== undefined && (typeof title !== 'string' || title.trim().length > 160))
    throw new UserFacingError('A title can have up to 160 characters.')
  if (!Array.isArray(providers) || providers.length < 1 || providers.length > 32)
    throw new UserFacingError('Send 1 to 32 network or account targets in providers.')

  const available = crosspostProviders()
  const targets = providers.map((provider: unknown) => {
    const target = typeof provider === 'string' ? parseTarget(provider, available) : null
    if (!target || (typeof provider === 'string' && provider.includes(':') && !isAccountProvider(target.provider)))
      throw new UserFacingError('Each target must be a network name or a network and account ID, such as bluesky:12.')
    return targetKey(target)
  })

  if (scheduledAt !== undefined && (typeof scheduledAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(scheduledAt)))
    throw new UserFacingError('Send scheduledAt as a UTC timestamp with seconds, such as 2027-01-20T18:30:00Z.')

  return {
    text: text.trim(),
    title: typeof title === 'string' ? title.trim() || null : null,
    providers: [...new Set(targets)],
    scheduledAt: typeof scheduledAt === 'string' ? scheduledAt.slice(0, -1).replace('T', ' ') : null,
  }
}

export default new Action({
  name: 'Postline API Create Post',
  description: 'Create a draft or a scheduled post with a scoped automation token.',
  method: 'POST',

  async handle(request: RequestInstance) {
    if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json')
      return response.json({ ok: false, error: 'Send application/json.' }, { status: 415 })
    const key = request.headers.get('idempotency-key')
    if (!key || !/^[A-Za-z0-9._:-]{1,128}$/.test(key))
      return response.json({ ok: false, error: 'Send a valid Idempotency-Key header.' }, { status: 400 })

    try {
      const input = readSubmission(request.jsonBody)
      const receipt = await postQueue.save(input, { requestKey: digest(key), fingerprint: digest(JSON.stringify(input)) })
      return response.json({ ok: true, data: receipt }, { status: 201 })
    }
    catch (error) {
      return actionFailure(error, error instanceof UserFacingError && error.code === 'submission_key_conflict' ? 409 : 422)
    }
  },
})
