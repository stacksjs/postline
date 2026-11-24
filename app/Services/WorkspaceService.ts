/**
 * The workspace: its name and the one time zone everything is scheduled and
 * charted in.
 *
 * There were three sources of time (the browser, each campaign's own zone,
 * and `TZ` from the environment) and the workspace row was created with a
 * personal name and Los Angeles written into the code. The row is now the
 * source: created from this machine's zone, edited in Settings, and read by
 * every service that stamps or buckets a time.
 */
import { db } from '@stacksjs/database'
import { env } from '@stacksjs/env'
import { UserFacingError } from '../Support/Http/user-error'
import { isValidTimeZone, systemTimeZone } from '../Support/time'
import { ensureAccount, now } from './Social/support'

const database = db as any

export interface WorkspaceProfile {
  /** The owner's name, as shown in the app. */
  name: string
  workspaceName: string
  timezone: string
  /** Share images for Instagram and Threads through a temporary public link. */
  shareMediaByTunnel: boolean
}

/** The zone a new workspace starts in: `TZ` when it names a real zone, else this machine's. */
export function defaultTimeZone(): string {
  const configured = String(env.TZ || '').trim()
  return isValidTimeZone(configured) ? configured : systemTimeZone()
}

export class WorkspaceService {
  private cached: { profile: WorkspaceProfile, at: number } | null = null

  async profile(): Promise<WorkspaceProfile> {
    // Read on every publish and every chart; a few seconds of memory spares
    // the query without letting a change in Settings go unseen for long.
    if (this.cached && Date.now() - this.cached.at < 5_000) return this.cached.profile

    const id = await ensureAccount()
    const row = await database
      .selectFrom('accounts')
      .select(['name', 'workspace_name', 'timezone', 'share_media_by_tunnel'])
      .where('id', '=', id)
      .executeTakeFirst()

    const profile: WorkspaceProfile = {
      name: String(row?.name || ''),
      workspaceName: String(row?.workspace_name || 'Postline'),
      // A zone the runtime does not know is replaced on read, so one bad
      // value in the row cannot break every schedule.
      timezone: isValidTimeZone(row?.timezone) ? String(row.timezone) : defaultTimeZone(),
      shareMediaByTunnel: Boolean(row?.share_media_by_tunnel),
    }
    this.cached = { profile, at: Date.now() }
    return profile
  }

  async timezone(): Promise<string> {
    return (await this.profile()).timezone
  }

  async save(input: { name?: string, workspaceName?: string, timezone?: string, shareMediaByTunnel?: boolean }): Promise<WorkspaceProfile> {
    const values: Record<string, unknown> = {}

    if (input.name !== undefined) {
      const name = input.name.trim()
      if (name.length < 2 || name.length > 120) throw new UserFacingError('Your name must be between 2 and 120 characters.')
      values.name = name
    }
    if (input.workspaceName !== undefined) {
      const workspaceName = input.workspaceName.trim()
      if (workspaceName.length < 2 || workspaceName.length > 120) throw new UserFacingError('The workspace name must be between 2 and 120 characters.')
      values.workspace_name = workspaceName
    }
    if (input.timezone !== undefined) {
      const timezone = input.timezone.trim()
      if (!isValidTimeZone(timezone)) throw new UserFacingError(`"${timezone}" is not a time zone Postline knows. Pick one from the list, such as Europe/Berlin.`)
      values.timezone = timezone
    }

    if (input.shareMediaByTunnel !== undefined) values.share_media_by_tunnel = Boolean(input.shareMediaByTunnel)

    if (Object.keys(values).length > 0) {
      const id = await ensureAccount()
      await database.updateTable('accounts').set({ ...values, updated_at: now() }).where('id', '=', id).execute()
    }

    this.cached = null
    return await this.profile()
  }

  /** For tests. */
  forget(): void {
    this.cached = null
  }
}

export const workspace = new WorkspaceService()
