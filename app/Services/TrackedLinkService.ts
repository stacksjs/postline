import type { UtmFields } from '../Support/Social/utm'
import { randomBytes } from 'node:crypto'
import { db } from '@stacksjs/database'
import { env } from '@stacksjs/env'
import { isDesktopAgent } from '../Support/Auth/native'
import { UserFacingError } from '../Support/Http/user-error'
import { isMarketingSite } from '../Support/Marketing/site'
import { isPublicBase } from '../Support/Social/uploads'
import { addUtmParameters } from '../Support/Social/utm'
import { ensureAccount, now } from './Social/support'

export const TRACKED_LINK_PATH = '/api/r/'
const validCode = /^[A-Za-z0-9_-]{16}$/
const fields = ['code', 'name', 'destination', 'visits', 'disabled'] as const

export interface TrackedLink {
  code: string
  name: string
  destination: string
  visits: number
  disabled: boolean
}

export function publicShortLinkOrigin(appUrl: unknown): string | null {
  const url = typeof appUrl === 'string' ? URL.parse(appUrl.trim()) : null
  return url?.protocol === 'https:' && !url.username && !url.password && isPublicBase(url.origin)
    ? url.origin
    : null
}

function configuredOrigin(): string | null {
  return isDesktopAgent() || isMarketingSite() ? null : publicShortLinkOrigin(env.APP_URL)
}

function checkedDestination(raw: unknown, values: UtmFields, origin: string | null): string {
  const destination = addUtmParameters(raw, values)
  const url = new URL(destination)
  if (!isPublicBase(url.origin)) throw new UserFacingError('Short links need a public destination.')
  if (origin && url.hostname.replace(/\.$/, '') === new URL(origin).hostname.replace(/\.$/, '') && url.pathname.startsWith(TRACKED_LINK_PATH))
    throw new UserFacingError('Use the original destination when shortening a link.')
  return destination
}

function checkedName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim() : ''
  if (!name || name.length > 100) throw new UserFacingError('Give the short link a name of up to 100 characters.')
  return name
}

export function readArchivedTrackedLink(value: unknown): TrackedLink {
  if (!value || typeof value !== 'object') throw new UserFacingError('That export contains an invalid short link.')
  const { code, name, destination, visits, disabled } = value as Record<string, unknown>
  if (typeof code !== 'string' || !validCode.test(code) || typeof visits !== 'number' || visits < 0 || !Number.isSafeInteger(visits) || typeof disabled !== 'boolean')
    throw new UserFacingError('That export contains an invalid short link.')
  return { code, name: checkedName(name), destination: checkedDestination(destination, {}, configuredOrigin()), visits, disabled }
}

export class TrackedLinkService {
  async export(accountId: number): Promise<TrackedLink[]> {
    const rows = await db.selectFrom('tracked_links').select(fields).where('account_id', '=', accountId).orderBy('id', 'desc').execute()
    return rows.map(row => readArchivedTrackedLink({ ...row, visits: Number(row.visits), disabled: Boolean(row.disabled) }))
  }

  async list() {
    const origin = configuredOrigin()
    const rows = await this.export(await ensureAccount())
    return {
      enabled: Boolean(origin),
      links: rows.map(row => ({ ...row, shortUrl: origin ? `${origin}${TRACKED_LINK_PATH}${row.code}` : null })),
    }
  }

  async create(input: { name: unknown, destination: unknown, utm: UtmFields }) {
    const origin = configuredOrigin()
    if (!origin) throw new UserFacingError('Short links need a public HTTPS Postline server.')
    const link = {
      code: randomBytes(12).toString('base64url'),
      name: checkedName(input.name),
      destination: checkedDestination(input.destination, input.utm, origin),
      visits: 0,
      disabled: false,
    }
    const timestamp = now()
    await db.insertInto('tracked_links').values({ ...link, account_id: await ensureAccount(), created_at: timestamp, updated_at: timestamp }).execute()
    return { ...link, shortUrl: `${origin}${TRACKED_LINK_PATH}${link.code}` }
  }

  async disable(code: unknown): Promise<void> {
    if (typeof code !== 'string' || !validCode.test(code)) throw new UserFacingError('Choose a short link.')
    await db.updateTable('tracked_links').set({ disabled: true, updated_at: now() })
      .where('code', '=', code).where('account_id', '=', await ensureAccount()).execute()
  }

  async resolve(code: unknown, count: boolean): Promise<string | null> {
    if (typeof code !== 'string' || !validCode.test(code) || !configuredOrigin()) return null
    const result = count
      ? (await db.unsafe(`UPDATE tracked_links SET visits = visits + 1
          WHERE code = ? AND disabled = 0 RETURNING destination`, [code]))[0]
      : await db.selectFrom('tracked_links').select('destination').where('code', '=', code).where('disabled', '=', false).executeTakeFirst()
    return typeof result?.destination === 'string' ? result.destination : null
  }

  async restore(accountId: number, link: TrackedLink): Promise<boolean> {
    const timestamp = now()
    const restored = await db.unsafe(`
      INSERT INTO tracked_links (code, name, destination, visits, disabled, account_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (code) DO NOTHING RETURNING code
    `, [link.code, link.name, link.destination, link.visits, Number(link.disabled), accountId, timestamp, timestamp])
    return restored.length > 0
  }
}

export const trackedLinks = new TrackedLinkService()
