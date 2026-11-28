/**
 * Take a workspace with you, bring one in, or delete it (#209).
 *
 * An archive is one JSON file: the workspace settings, every post with its
 * results on each network, threads, campaigns, saved Composer text, blog posts and Listening
 * rules, and the images attached to queued posts and Blog articles, embedded. Rows travel by
 * their uuid, never their numeric id, so links between them (a result to its
 * post, a campaign post to its campaign) survive the move, and importing the
 * same archive twice changes nothing the second time.
 *
 * What it leaves out on purpose: network sign-ins and app secrets, the AI
 * key, and the sign-in account. Those belong to this install and are
 * reconnected on the next one; an archive that held them would be a file
 * that can post as you.
 */
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { db, sqliteWriteOptions } from '@stacksjs/database'
import { UserFacingError } from '../Support/Http/user-error'
import type { ArchivedTargetAccount, IdentityLike } from '../Support/Social/accounts'
import { archivedTargetAccount, matchArchivedTargetAccount } from '../Support/Social/accounts'
import { xBrowserPostId } from '../Support/Social/x-browser-write'
import { readBlogAttachments } from '../Support/Social/blog-attachments'
import { checkImageBytes } from '../Support/Social/image-input'
import { checkVideoBytes } from '../Support/Social/video-input'
import { MAX_IMAGE_BYTES, MAX_POST_IMAGES, MAX_VIDEO_BYTES } from '../Support/Social/media-rules'
import type { PostingSlot } from '../Support/Social/posting-slots'
import { referencedMediaFiles } from '../Support/Social/stored-content'
import { isAccountProvider } from '../Support/Social/targets'
import { isSafeMediaFilename, MEDIA_DIR } from '../Support/Social/uploads'
import type { ComposerPreset } from './ComposerPresetService'
import type { ArchivedDraftFeed } from './DraftFeedService'
import type { ArchivedRecurringPost } from './RecurringPostService'
import type { TrackedLink } from './TrackedLinkService'
import { composerPresets, readComposerPreset } from './ComposerPresetService'
import { draftFeeds, readArchivedDraftFeed } from './DraftFeedService'
import { addPostingSlot, listPostingSlots, readPostingSlot } from './PostingSlotService'
import { readArchivedRecurringPost, recurringPosts } from './RecurringPostService'
import { blog } from './Social/BlogService'
import { ensureAccount, now, uuid } from './Social/support'
import { readArchivedTrackedLink, trackedLinks } from './TrackedLinkService'

const database = db as any

export const ARCHIVE_FORMAT = 'postline-workspace'
export const ARCHIVE_VERSION = 11

/** Typed to delete everything, so a stray click cannot. */
export const DELETE_EVERYTHING_PHRASE = 'DELETE EVERYTHING'

const POST_COLUMNS = ['uuid', 'title', 'body', 'content', 'status', 'scheduled_at', 'published_at', 'timezone', 'source', 'thread_key', 'created_at', 'updated_at'] as const
const TARGET_COLUMNS = ['uuid', 'provider', 'status', 'remote_uri', 'remote_url', 'remote_cid', 'failure_reason', 'metrics', 'attempts', 'first_comment_body', 'first_comment_status', 'first_comment_remote_id', 'first_comment_error', 'created_at', 'updated_at'] as const
const CAMPAIGN_COLUMNS = ['uuid', 'name', 'objective', 'audience', 'tone', 'status', 'start_date', 'end_date', 'timezone', 'created_at', 'updated_at'] as const
const CAMPAIGN_POST_COLUMNS = ['uuid', 'title', 'body', 'providers', 'pillar', 'status', 'scheduled_at', 'position', 'created_at', 'updated_at'] as const
const MONITOR_COLUMNS = ['uuid', 'name', 'keywords', 'providers', 'match_mode', 'status', 'twitter_read_source', 'created_at', 'updated_at'] as const
// Not the AI provider: it means nothing without its key, which stays behind.
// Nor whether automatic deletion is on: switching on a schedule that deletes
// posts takes the owner's own confirmation in Settings, on each install.
const SETTINGS_COLUMNS = ['name', 'workspace_name', 'timezone', 'share_media_by_tunnel', 'default_audience', 'auto_delete_days', 'auto_delete_providers', 'auto_delete_scope'] as const

interface ArchivedBlogPost {
  title: string
  slug: string
  body: string
  status: string
  publishedAt: string | null
  access?: 'free' | 'paid'
  attachments?: Array<{ data: string, alt: string }>
}

interface ArchivedBrowserDispatch {
  post: string
  handle: string
  state: 'submitting' | 'published'
  remoteId: string | null
}

export interface WorkspaceArchive {
  format: typeof ARCHIVE_FORMAT
  version: number
  exportedAt: string
  settings: Record<string, unknown>
  posts: Array<Record<string, unknown>>
  targets: Array<Record<string, unknown> & { post: string, account: ArchivedTargetAccount | null }>
  twitterBrowserDispatches: ArchivedBrowserDispatch[]
  campaigns: Array<Record<string, unknown>>
  campaignPosts: Array<Record<string, unknown> & { campaign: string, post: string | null }>
  blogPosts: ArchivedBlogPost[]
  monitors: Array<Record<string, unknown>>
  composerPresets: ComposerPreset[]
  trackedLinks: TrackedLink[]
  draftFeeds: ArchivedDraftFeed[]
  postingSlots: PostingSlot[]
  recurringPosts: ArchivedRecurringPost[]
  /** Images attached to queued posts, by file name, as base64. */
  media: Record<string, string>
}

export interface ImportReport {
  posts: number
  targets: number
  campaigns: number
  campaignPosts: number
  blogPosts: number
  monitors: number
  composerPresets: number
  trackedLinks: number
  draftFeeds: number
  postingSlots: number
  recurringPosts: number
  media: number
  /** Rows already here (same uuid), left as they are. */
  skipped: number
}

function pick(row: Record<string, unknown>, columns: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(columns.map(column => [column, row[column] ?? null]))
}

function readTargetAccount(provider: unknown, value: unknown): ArchivedTargetAccount | null {
  if (value == null) return null
  const account = value as Partial<ArchivedTargetAccount>
  if (typeof provider !== 'string' || !isAccountProvider(provider) || account.provider !== provider
    || typeof account.handle !== 'string' || !account.handle.trim()
    || (account.transport !== undefined && (provider !== 'twitter' || account.transport !== 'browser'))
    || (account.externalId !== undefined && (typeof account.externalId !== 'string' || !account.externalId.trim() || provider === 'mastodon')))
    throw new UserFacingError('A publishing target in this export has an invalid account reference.')

  return { provider, handle: account.handle.trim(), ...(account.externalId && { externalId: account.externalId.trim() }), ...(account.transport && { transport: account.transport }) }
}

function readBrowserDispatch(value: unknown): ArchivedBrowserDispatch {
  const receipt = value as Partial<ArchivedBrowserDispatch> | null
  if (!receipt || typeof receipt.post !== 'string' || !receipt.post
    || typeof receipt.handle !== 'string' || !/^[A-Za-z0-9_]{1,15}$/.test(receipt.handle)
    || !((receipt.state === 'submitting' && receipt.remoteId === null)
      || (receipt.state === 'published' && xBrowserPostId(receipt.remoteId))))
    throw new UserFacingError('That export contains an invalid X browser publish receipt.')
  return { post: receipt.post, handle: receipt.handle.toLowerCase(), state: receipt.state, remoteId: receipt.remoteId }
}

function readArchivedImage(data: unknown, message: string) {
  if (typeof data !== 'string' || data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4)
    throw new UserFacingError(message)
  const checked = checkImageBytes(Buffer.from(data, 'base64'))
  if (!checked.ok) throw new UserFacingError(message)
  return checked
}

function readArchivedMedia(name: string, data: unknown): Uint8Array {
  if (!name.toLowerCase().endsWith('.mp4'))
    return readArchivedImage(data, 'That export contains an invalid queued image.').bytes

  const message = 'That export contains an invalid queued video.'
  if (typeof data !== 'string' || data.length > Math.ceil(MAX_VIDEO_BYTES / 3) * 4)
    throw new UserFacingError(message)
  const checked = checkVideoBytes(Buffer.from(data, 'base64'))
  if (!checked.ok) throw new UserFacingError(message)
  return checked.video.bytes
}

/** Called under the queue restore write lock. Existing files belong to the workspace. */
function installArchivedMedia(media: ReadonlyArray<readonly [string, Uint8Array]>): number {
  const missing = media.filter(([name]) => !existsSync(join(MEDIA_DIR, name)))
  if (!missing.length) return 0

  mkdirSync(MEDIA_DIR, { recursive: true })
  const staging = mkdtempSync(join(MEDIA_DIR, '.archive-'))
  const installed: string[] = []
  try {
    for (const [name, bytes] of missing) {
      const temporary = join(staging, name)
      const path = join(MEDIA_DIR, name)
      writeFileSync(temporary, bytes)
      renameSync(temporary, path)
      installed.push(path)
    }
    return installed.length
  }
  catch (error) {
    for (const path of installed) rmSync(path, { force: true })
    throw error
  }
  finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

export class WorkspaceArchiveService {
  async export(): Promise<WorkspaceArchive> {
    const accountId = await ensureAccount()
    const account = await database.selectFrom('accounts').selectAll().where('id', '=', accountId).executeTakeFirst()
    // Read posts with their targets and feed receipts from one snapshot.
    const { posts, targets, dispatches, identities, feeds, slots, repeats } = await database.transaction((tx: typeof database) => {
      const posts = tx.selectFrom('posts').selectAll().where('status', '!=', 'archived').orderBy('id', 'asc').execute()
      const postIds = posts.map((post: any) => post.id)
      return {
        posts,
        targets: postIds.length ? tx.selectFrom('post_targets').selectAll().where('post_id', 'in', postIds).execute() : [],
        dispatches: postIds.length ? tx.selectFrom('twitter_browser_dispatches').select(['post_id', 'handle', 'state', 'remote_id'])
          .where('post_id', 'in', postIds).where('state', 'in', ['submitting', 'published']).execute() : [],
        identities: tx.selectFrom('social_identities').select(['id', 'provider', 'handle', 'external_id', 'auth_transport']).execute(),
        feeds: draftFeeds.export(accountId, tx),
        slots: listPostingSlots(accountId, tx),
        repeats: recurringPosts.export(accountId, tx),
      }
    })
    const postUuid = new Map<number, string>(posts.map((post: any) => [Number(post.id), String(post.uuid)]))
    const identityOf = new Map<number, ArchivedTargetAccount>(identities.map((row: IdentityLike) => [Number(row.id), archivedTargetAccount(row)]))
    const campaigns = await database.selectFrom('launch_campaigns').selectAll().orderBy('id', 'asc').execute()
    const campaignUuid = new Map<number, string>(campaigns.map((row: any) => [Number(row.id), String(row.uuid)]))
    const campaignPosts = await database.selectFrom('campaign_posts').selectAll().orderBy('id', 'asc').execute()
    const blogRows = await database.selectFrom('blog_posts').selectAll().where('status', 'in', ['draft', 'published']).orderBy('id', 'asc').execute()
    const monitors = await database.selectFrom('keyword_monitors').selectAll().orderBy('id', 'asc').execute()

    const media: Record<string, string> = {}
    const recurringSegments = repeats.flatMap((rule: ArchivedRecurringPost) => rule.template.segments)
    for (const post of [...posts, ...recurringSegments]) {
      for (const name of referencedMediaFiles(post.content)) {
        const path = join(MEDIA_DIR, name)
        if (existsSync(path)) media[name] = Buffer.from(await readFile(path)).toString('base64')
      }
    }

    const blogPosts: ArchivedBlogPost[] = []
    for (const row of blogRows) {
      const attachments = await Promise.all(readBlogAttachments(row.attachments).map(async ({ file, alt }) => ({
        data: (await readFile(join(MEDIA_DIR, file))).toString('base64'),
        alt,
      })))
      blogPosts.push({
        title: String(row.title), slug: String(row.slug), body: String(row.body),
        status: String(row.status), publishedAt: row.published_at || null,
        access: row.access === 'paid' ? 'paid' : 'free', attachments,
      })
    }

    return {
      format: ARCHIVE_FORMAT,
      version: ARCHIVE_VERSION,
      exportedAt: now(),
      settings: account ? pick(account, SETTINGS_COLUMNS) : {},
      posts: posts.map((post: any) => pick(post, POST_COLUMNS)),
      targets: targets.filter((row: any) => postUuid.has(Number(row.post_id))).map((row: any) => ({
        ...pick(row, TARGET_COLUMNS),
        post: postUuid.get(Number(row.post_id))!,
        account: row.archived_account ? JSON.parse(row.archived_account) : identityOf.get(Number(row.social_identity_id)) ?? null,
      })),
      twitterBrowserDispatches: dispatches.map((row: any) => ({
        post: postUuid.get(Number(row.post_id))!, handle: row.handle, state: row.state, remoteId: row.remote_id,
      })),
      campaigns: campaigns.map((row: any) => pick(row, CAMPAIGN_COLUMNS)),
      campaignPosts: campaignPosts.filter((row: any) => campaignUuid.has(Number(row.launch_campaign_id))).map((row: any) => ({
        ...pick(row, CAMPAIGN_POST_COLUMNS),
        campaign: campaignUuid.get(Number(row.launch_campaign_id))!,
        post: row.post_id ? postUuid.get(Number(row.post_id)) ?? null : null,
      })),
      blogPosts,
      monitors: monitors.map((row: any) => ({
        ...pick(row, MONITOR_COLUMNS), twitter_browser_background: Boolean(row.twitter_browser_background),
      })),
      composerPresets: await composerPresets.list(accountId),
      trackedLinks: await trackedLinks.export(accountId),
      draftFeeds: feeds,
      postingSlots: slots,
      recurringPosts: repeats,
      media,
    }
  }

  async import(input: unknown): Promise<ImportReport> {
    const archive = input as WorkspaceArchive
    if (!archive || archive.format !== ARCHIVE_FORMAT)
      throw new UserFacingError('That is not a Postline workspace export.')
    const version = Number(archive.version)
    if (!Number.isSafeInteger(version) || version < 1)
      throw new UserFacingError('That workspace export has an invalid version.')
    if (version > ARCHIVE_VERSION)
      throw new UserFacingError('That export is from a newer Postline. Update this one, then import it.')

    if (version >= 4 && !Array.isArray(archive.composerPresets))
      throw new UserFacingError('That export is missing its saved Composer text.')
    const presets = version >= 4 ? archive.composerPresets.map(readComposerPreset) : []
    if (version >= 5 && !Array.isArray(archive.trackedLinks))
      throw new UserFacingError('That export is missing its tracked links.')
    const links = version >= 5 ? archive.trackedLinks.map(readArchivedTrackedLink) : []
    if (version >= 6 && !Array.isArray(archive.draftFeeds))
      throw new UserFacingError('That export is missing its draft feeds.')
    const feeds = version >= 6 ? archive.draftFeeds.map(readArchivedDraftFeed) : []
    if (version >= 7 && !Array.isArray(archive.postingSlots))
      throw new UserFacingError('That export is missing its posting slots.')
    const slots = version >= 7 ? archive.postingSlots.map(readPostingSlot) : []
    if (version >= 8 && !Array.isArray(archive.recurringPosts))
      throw new UserFacingError('That export is missing its recurring posts.')
    const repeats = version >= 8 ? archive.recurringPosts.map(readArchivedRecurringPost) : []
    if (version >= 10 && !Array.isArray(archive.twitterBrowserDispatches))
      throw new UserFacingError('That export is missing its X browser publish receipts.')
    const dispatches = version >= 10 ? archive.twitterBrowserDispatches.map(readBrowserDispatch) : []

    const targets: WorkspaceArchive['targets'] = (archive.targets || []).map(target => ({
      ...target,
      account: readTargetAccount(target.provider, target.account),
    }))

    const monitors = (archive.monitors || []).map((monitor) => {
      // Browser-session watches first appeared in version 3. Require the source
      // in these exports so losing the field cannot turn a watch into API spend.
      const source = version < 3 ? monitor.twitter_read_source ?? 'api' : monitor.twitter_read_source
      if (source !== 'api' && source !== 'browser')
        throw new UserFacingError('A Listening watch in this export has an invalid X read source.')
      const background = version < 11 ? false : monitor.twitter_browser_background
      if (typeof background !== 'boolean' || (background && source !== 'browser'))
        throw new UserFacingError('A Listening watch in this export has an invalid X background check setting.')
      return {
        ...pick(monitor, MONITOR_COLUMNS), uuid: monitor.uuid ?? null, twitter_read_source: source, twitter_browser_background: background,
      }
    })
    const mediaEntries = Object.entries(archive.media || {})
    try {
      for (const post of archive.posts || []) referencedMediaFiles(post.content)
      if (mediaEntries.some(([name]) => !isSafeMediaFilename(name))) throw new Error('Invalid media filename')
    }
    catch {
      throw new UserFacingError('That export contains an invalid stored attachment reference.')
    }

    const media = mediaEntries.map(([name, data]) => [name, readArchivedMedia(name, data)] as const)

    const blogPosts = (archive.blogPosts || []).filter(post => post.status === 'published' || post.status === 'draft')
      .map((post) => {
        const attachments = post.attachments
        if (attachments !== undefined && (!Array.isArray(attachments) || attachments.length > MAX_POST_IMAGES))
          throw new UserFacingError('That export contains invalid Blog attachments.')
        const images = attachments?.map((image) => {
          const message = 'That export contains an invalid Blog image.'
          if (typeof image?.alt !== 'string') throw new UserFacingError(message)
          const checked = readArchivedImage(image.data, message)
          return { bytes: checked.bytes, mimeType: checked.mimeType, altText: image.alt }
        })
        return { ...post, images }
      })

    const report: ImportReport = { posts: 0, targets: 0, campaigns: 0, campaignPosts: 0, blogPosts: 0, monitors: 0, composerPresets: 0, trackedLinks: 0, draftFeeds: 0, postingSlots: 0, recurringPosts: 0, media: 0, skipped: 0 }
    const accountId = await ensureAccount()
    const idOf = (table: string, uuid: unknown, tx = database): number | null => {
      const row = uuid ? tx.selectFrom(table).select(['id']).where('uuid', '=', String(uuid)).executeTakeFirst() : null
      return row ? Number(row.id) : null
    }
    const exists = (table: string, uuid: unknown, tx = database) => idOf(table, uuid, tx) !== null

    // Make settings, posts and targets visible only after local attachments
    // are installed. The write lock also serializes concurrent imports.
    await database.transaction((tx: typeof database) => {
      if (archive.settings && Object.keys(archive.settings).length) {
        const allowed = Object.fromEntries(Object.entries(archive.settings).filter(([key]) => (SETTINGS_COLUMNS as readonly string[]).includes(key)))
        tx.updateTable('accounts').set({ ...allowed, updated_at: now() }).where('id', '=', accountId).execute()
      }

      for (const post of archive.posts || []) {
        if (exists('posts', post.uuid, tx)) { report.skipped++; continue }
        tx.insertInto('posts').values({ ...pick(post, POST_COLUMNS), account_id: accountId }).execute()
        report.posts++
      }
      for (const dispatch of dispatches) {
        const postId = idOf('posts', dispatch.post, tx)
        if (!postId) continue
        const existing = tx.selectFrom('twitter_browser_dispatches').select(['id', 'state'])
          .where('post_id', '=', postId).where('handle', '=', dispatch.handle).executeTakeFirst()
        const values = { uuid: uuid(), state: dispatch.state, remote_id: dispatch.remoteId, updated_at: now() }
        if (!existing) {
          tx.insertInto('twitter_browser_dispatches').values({
            ...values, post_id: postId, handle: dispatch.handle, created_at: now(),
          }).execute()
        }
        else if (existing.state === 'refused') {
          tx.updateTable('twitter_browser_dispatches').set(values).where('id', '=', existing.id).execute()
        }
      }

      const identities: IdentityLike[] = tx.selectFrom('social_identities')
        .select(['id', 'provider', 'handle', 'external_id', 'auth_status', 'auth_transport']).execute()
      for (const target of targets) {
        if (exists('post_targets', target.uuid, tx)) { report.skipped++; continue }
        const postId = idOf('posts', target.post, tx)
        if (!postId) continue
        const identity = target.account ? matchArchivedTargetAccount(identities, target.account) : undefined
        const restored = pick(target, TARGET_COLUMNS)
        if (restored.first_comment_status && restored.first_comment_status !== 'sent') {
          // The original installation may have sent it after the archive was made.
          restored.first_comment_status = 'uncertain'
          restored.first_comment_error = 'Check for the first comment on the published post after restoring this workspace.'
        }
        tx.insertInto('post_targets').values({
          ...restored, post_id: postId, social_identity_id: identity ? Number(identity.id) : null,
          archived_account: target.account && !identity ? JSON.stringify(target.account) : null,
        }).execute()
        report.targets++
      }

      report.media += installArchivedMedia(media)
    }, sqliteWriteOptions())

    for (const campaign of archive.campaigns || []) {
      if (exists('launch_campaigns', campaign.uuid)) { report.skipped++; continue }
      await database.insertInto('launch_campaigns').values({ ...pick(campaign, CAMPAIGN_COLUMNS), account_id: accountId }).execute()
      report.campaigns++
    }

    for (const item of archive.campaignPosts || []) {
      if (exists('campaign_posts', item.uuid)) { report.skipped++; continue }
      const campaignId = idOf('launch_campaigns', item.campaign)
      if (!campaignId) continue
      await database.insertInto('campaign_posts').values({ ...pick(item, CAMPAIGN_POST_COLUMNS), launch_campaign_id: campaignId, post_id: idOf('posts', item.post) }).execute()
      report.campaignPosts++
    }

    const createdThisRun = new Set<string>()
    for (const post of blogPosts) {
      const outcome = await blog.importPost({
        title: post.title,
        body: post.body,
        slug: post.slug,
        publishedAt: post.publishedAt || now(),
        status: post.status === 'draft' ? 'draft' : 'published',
        access: post.access === 'paid' ? 'paid' : post.access === 'free' ? 'free' : undefined,
        images: post.images,
      }, { createdThisRun })
      if (outcome === 'created') report.blogPosts++
      else report.skipped++
      report.media += post.images?.length || 0
    }

    for (const monitor of monitors) {
      if (exists('keyword_monitors', monitor.uuid)) { report.skipped++; continue }
      await database.insertInto('keyword_monitors').values({ ...monitor, account_id: accountId }).execute()
      report.monitors++
    }

    for (const preset of presets) {
      if (await composerPresets.restore(accountId, preset)) report.composerPresets++
      else report.skipped++
    }

    for (const link of links) {
      if (await trackedLinks.restore(accountId, link)) report.trackedLinks++
      else report.skipped++
    }

    for (const feed of feeds) {
      if (await draftFeeds.restore(accountId, feed)) report.draftFeeds++
      else report.skipped++
    }

    if (slots.length) {
      report.postingSlots = await database.transaction((tx: typeof database) =>
        slots.filter(slot => addPostingSlot(accountId, slot, tx)).length)
      report.skipped += slots.length - report.postingSlots
    }

    for (const repeat of repeats) {
      if (await recurringPosts.restore(accountId, repeat)) report.recurringPosts++
      else report.skipped++
    }

    return report
  }

  /**
   * Delete the workspace's content and connections from this install: posts
   * and their results, campaigns, the blog, Listening, the inbox's copies,
   * connected accounts, network apps, the AI key and attached images. The
   * sign-in account stays so the owner can still get in. Nothing is deleted
   * on the networks themselves.
   */
  async deleteEverything(confirmation: string): Promise<{ deleted: Record<string, number> }> {
    if (String(confirmation).trim() !== DELETE_EVERYTHING_PHRASE)
      throw new UserFacingError(`Type ${DELETE_EVERYTHING_PHRASE} to confirm.`)

    const deleted: Record<string, number> = {}
    const wipe = async (table: string) => {
      const result = await database.deleteFrom(table).executeTakeFirst()
      deleted[table] = Number(result?.numDeletedRows ?? result?.changes ?? 0)
    }

    const blogPosts = await database.selectFrom('blog_posts').select(['id']).execute()
    for (const post of blogPosts) await blog.remove(Number(post.id)).catch(() => {})

    await database.transaction((tx: typeof database) => {
      for (const table of ['draft_feed_entries', 'draft_feeds', 'posting_slots', 'recurring_posts']) {
        const result = tx.deleteFrom(table).executeTakeFirst()
        deleted[table] = Number(result?.numDeletedRows ?? result?.changes ?? 0)
      }
    })

    for (const table of ['campaign_posts', 'launch_campaigns', 'post_targets', 'twitter_browser_dispatches', 'thread_publish_claims', 'social_operation_leases', 'posts', 'post_submissions', 'post_webhook_deliveries', 'keyword_mentions', 'keyword_monitors', 'composer_presets', 'tracked_links', 'inbox_mentions', 'dm_messages', 'dm_conversations', 'timeline_items', 'purge_previews', 'purge_runs', 'alerts', 'social_identities', 'network_apps', 'twitter_read_usage'])
      await wipe(table)

    const accountId = await ensureAccount()
    await database.updateTable('accounts').set({
      ai_provider: null,
      ai_api_key: null,
      ai_model: null,
      auto_delete_enabled: false,
      twitter_browser_handle: null,
      twitter_browser_needs_check: false,
      twitter_browser_needs_layout_check: false,
      twitter_browser_listening_attention: false,
      twitter_browser_listening_attempted_at: null,
      twitter_browser_composer_attempted_at: null,
      twitter_browser_composer_claim: null,
      twitter_browser_composer_status: null,
      updated_at: now(),
    }).where('id', '=', accountId).execute()
    await rm(MEDIA_DIR, { recursive: true, force: true })
    return { deleted }
  }
}

export const workspaceArchive = new WorkspaceArchiveService()
