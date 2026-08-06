import type { SocialProvider } from '../Support/Social/types'
import { db } from '@stacksjs/database'
import { env } from '@stacksjs/env'
import type { CampaignAIStrategy, CampaignAISuggestion } from './CampaignAIService'
import { campaignAI } from './CampaignAIService'
import { postQueue } from './Social/QueueService'
import { ensureAccount, now, uuid } from './Social/support'

const database = db as any

export const CAMPAIGN_PROVIDERS: SocialProvider[] = [
  'bluesky',
  'twitter',
  'mastodon',
  'instagram',
  'linkedin',
  'threads',
  'blog',
]

export const CAMPAIGN_PILLARS = ['teaser', 'story', 'education', 'proof', 'launch', 'follow-up'] as const
export const CAMPAIGN_TONES = ['clear', 'bold', 'warm', 'technical', 'playful'] as const

type CampaignPillar = typeof CAMPAIGN_PILLARS[number]
type CampaignTone = typeof CAMPAIGN_TONES[number]

export interface CampaignInput {
  name: string
  objective?: string | null
  audience?: string | null
  tone?: CampaignTone
  startDate: string
  endDate: string
  timezone?: string
}

export interface CampaignPostInput {
  campaignId: number
  id?: number
  title: string
  body: string
  providers: SocialProvider[]
  pillar?: CampaignPillar
  status?: 'idea' | 'ready' | 'skipped'
  scheduledAt: string
  position?: number
}

export interface CampaignPostView {
  id: number
  title: string
  body: string
  providers: SocialProvider[]
  pillar: CampaignPillar
  status: string
  scheduledAt: string
  position: number
  postId: number | null
}

export interface CampaignView {
  id: number
  uuid: string
  name: string
  objective: string
  audience: string
  tone: CampaignTone
  status: string
  startDate: string
  endDate: string
  timezone: string
  postCount: number
  queuedCount: number
}

interface PlanSuggestion extends CampaignAISuggestion {
  title: string
  body: string
  pillar: CampaignPillar
  offsetDays: number
  time: string
  providers: SocialProvider[]
}

function dateOnly(value: string): string {
  return value.trim().slice(0, 10)
}

function assertDate(value: string, field: string): string {
  const normalized = dateOnly(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00Z`)))
    throw new Error(`${field} must be a valid date.`)
  return normalized
}

function sqliteTimestamp(value: string): string {
  const normalized = value.trim().replace('T', ' ')
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/.test(normalized))
    throw new Error('Post time must include a date and time.')
  const timestamp = normalized.length === 16 ? `${normalized}:00` : normalized
  if (Number.isNaN(Date.parse(`${timestamp.replace(' ', 'T')}Z`)))
    throw new Error('Post time is not valid.')
  return timestamp
}

export function normalizeProviders(values: unknown): SocialProvider[] {
  const list = Array.isArray(values) ? values : String(values || '').split(',')
  const allowed = new Set<string>(CAMPAIGN_PROVIDERS)
  return [...new Set(list.map(value => String(value).trim().toLowerCase()).filter(value => allowed.has(value)))] as SocialProvider[]
}

export function scheduleFromOffset(startDate: string, offsetDays: number, time = '09:00'): string {
  const start = new Date(`${assertDate(startDate, 'Campaign start')}T00:00:00Z`)
  const safeOffset = Math.max(0, Math.min(365, Math.round(Number(offsetDays) || 0)))
  start.setUTCDate(start.getUTCDate() + safeOffset)
  const safeTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : '09:00'
  return `${start.toISOString().slice(0, 10)} ${safeTime}:00`
}

function parseProviders(raw: unknown): SocialProvider[] {
  try {
    return normalizeProviders(JSON.parse(String(raw || '[]')))
  }
  catch {
    return normalizeProviders(raw)
  }
}

function campaignRow(row: any, counts?: { posts?: number, queued?: number }): CampaignView {
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    name: String(row.name),
    objective: String(row.objective || ''),
    audience: String(row.audience || ''),
    tone: CAMPAIGN_TONES.includes(row.tone) ? row.tone : 'clear',
    status: String(row.status),
    startDate: String(row.start_date).slice(0, 10),
    endDate: String(row.end_date).slice(0, 10),
    timezone: String(row.timezone || 'America/Los_Angeles'),
    postCount: Number(counts?.posts || 0),
    queuedCount: Number(counts?.queued || 0),
  }
}

function postRow(row: any): CampaignPostView {
  return {
    id: Number(row.id),
    title: String(row.title),
    body: String(row.body),
    providers: parseProviders(row.providers),
    pillar: CAMPAIGN_PILLARS.includes(row.pillar) ? row.pillar : 'story',
    status: String(row.status),
    scheduledAt: String(row.scheduled_at),
    position: Number(row.position || 0),
    postId: row.post_id ? Number(row.post_id) : null,
  }
}

export function buildCampaignFallbackPlan(
  campaign: CampaignView,
  count: number,
  providers: SocialProvider[],
  strategy: CampaignAIStrategy = 'full-launch',
  existingPosts: CampaignPostView[] = [],
): PlanSuggestion[] {
  const objective = campaign.objective || `Share ${campaign.name} with the people it is for.`
  const audience = campaign.audience || 'the people who follow your work'
  const campaignDays = Math.max(0, Math.floor((Date.parse(campaign.endDate) - Date.parse(campaign.startDate)) / 86400000))
  const cadence = Math.max(1, Math.floor(Math.max(7, campaignDays) / Math.max(1, count - 1)))
  const standardSeeds: Array<Omit<PlanSuggestion, 'offsetDays' | 'providers'>> = [
    { title: 'The first signal', body: `Something new is taking shape. Over the next few weeks, we will share how ${campaign.name} helps ${audience}.`, pillar: 'teaser', time: '09:15' },
    { title: 'Why this matters', body: `${objective} Here is the problem we kept seeing, and why we decided it was worth solving now.`, pillar: 'story', time: '10:30' },
    { title: 'A useful lesson', body: `One thing we learned while building ${campaign.name}: start with the outcome, then remove every step that does not help people reach it.`, pillar: 'education', time: '09:45' },
    { title: 'Show the work', body: `A closer look at ${campaign.name}. This is what the experience looks like, how it works, and where it fits into a real workflow.`, pillar: 'proof', time: '11:00' },
    { title: 'Launch day', body: `${campaign.name} is ready. ${objective} Take a look, try it in your workflow, and tell us what would make it more useful.`, pillar: 'launch', time: '08:30' },
    { title: 'What we heard', body: `Thank you for the thoughtful response to ${campaign.name}. We are collecting the questions and feedback that will shape what comes next.`, pillar: 'follow-up', time: '10:00' },
    { title: 'Behind the decision', body: `A small product decision can change the whole experience. Here is one choice we made for ${campaign.name}, plus the tradeoff behind it.`, pillar: 'story', time: '09:30' },
    { title: 'One week later', body: `${campaign.name} has been out in the world for a week. Here is what is working, what surprised us, and what we are improving next.`, pillar: 'follow-up', time: '10:15' },
  ]
  const stacksSeeds: Array<Omit<PlanSuggestion, 'offsetDays' | 'providers'>> = [
    { title: 'One command surface', body: 'Buddy gives Stacks one command surface for local development, scaffolding, models, migrations, testing, builds, releases, and cloud deployment. The goal is simple: spend less time remembering tool syntax and more time shaping the product.', pillar: 'education', time: '09:45' },
    { title: 'One application model', body: 'A Stacks app keeps reactive STX views, Router actions, models, jobs, and infrastructure in one TypeScript project. The interesting part is not a longer feature list. It is how those parts share conventions and work together.', pillar: 'proof', time: '11:00' },
    { title: 'Native without a rewrite', body: 'Craft opens the same Stacks application as a native desktop window, with typed access to window, tray, files, and notifications. The Open Times is one working example: the browser and desktop app share the same routes, actions, and UI.', pillar: 'proof', time: '10:30' },
    { title: 'Models own the schema', body: 'In Stacks, application models describe the data shape and Buddy derives the migration path. That keeps database changes close to the code that owns them, while SQLite, queues, scheduled jobs, and APIs stay in the same toolkit.', pillar: 'education', time: '09:30' },
    { title: 'Why cohesion matters', body: 'Stacks is not about pretending software has no dependencies. It is about designing and maintaining the major framework capabilities together, in-house, so routing, UI, data, AI, desktop, and deployment feel like one system instead of a kit of adapters.', pillar: 'story', time: '09:15' },
    { title: 'Pre-alpha, in the open', body: 'Stacks is pre-alpha and already runnable. We are sharing the real work now because this is when focused feedback has the most leverage. Expect sharp edges, transparent tradeoffs, frequent releases, and visible progress toward alpha.', pillar: 'teaser', time: '10:00' },
    { title: 'The alpha milestone', body: 'The next Stacks milestone is a dependable alpha path: create a project, build a real web or desktop app, model its data, test it, and deploy it with Buddy. We will publish the proof for each step and ask for feedback where it can change the outcome.', pillar: 'launch', time: '08:30' },
    { title: 'Help shape the beta', body: 'If you build with TypeScript or Bun, try one Stacks workflow and tell us where the conventions help or get in your way. Those concrete reports will shape the alpha hardening work and the beta experience that follows.', pillar: 'follow-up', time: '10:15' },
  ]
  const seeds = strategy === 'stacks-launch' ? stacksSeeds : standardSeeds

  const preferredPillars: Partial<Record<CampaignAIStrategy, CampaignPillar[]>> = {
    'stacks-launch': ['education', 'proof', 'story', 'teaser', 'launch', 'follow-up'],
    education: ['education', 'story', 'proof', 'teaser', 'launch', 'follow-up'],
    proof: ['proof', 'story', 'education', 'teaser', 'launch', 'follow-up'],
  }
  const existingPillars = new Set(existingPosts.map(post => post.pillar))
  const orderedSeeds = strategy === 'fill-gaps'
    ? [...seeds].sort((left, right) => Number(existingPillars.has(left.pillar)) - Number(existingPillars.has(right.pillar)))
    : preferredPillars[strategy]
      ? [...seeds].sort((left, right) => preferredPillars[strategy]!.indexOf(left.pillar) - preferredPillars[strategy]!.indexOf(right.pillar))
      : seeds
  const usedBodies = new Set(existingPosts.map(post => post.body.trim().toLowerCase()))

  return Array.from({ length: count }, (_, index) => {
    const launchWeekOffset = Math.max(0, campaignDays - Math.min(6, count - 1)) + Math.min(index, 6)
    const seed = orderedSeeds[index % orderedSeeds.length] as Omit<PlanSuggestion, 'offsetDays' | 'providers'>
    let variation = Math.floor(index / orderedSeeds.length)
    let title = seed.title
    let body = seed.body
    while (usedBodies.has(body.trim().toLowerCase())) {
      variation += 1
      title = `${seed.title}, angle ${variation + 1}`
      body = `Another useful angle for this campaign: ${seed.body}`
      if (variation > 1) body = `Campaign angle ${variation + 1}: ${seed.body}`
    }
    usedBodies.add(body.trim().toLowerCase())
    return {
      ...seed,
      title,
      body,
      offsetDays: strategy === 'launch-week' ? launchWeekOffset : Math.min(campaignDays, index * cadence),
      providers,
    }
  })
}

export function campaignBodyLimit(providers: SocialProvider[]): number {
  const limits: Partial<Record<SocialProvider, number>> = { twitter: 280, bluesky: 300, mastodon: 500, threads: 500, instagram: 2200, linkedin: 3000, blog: 4000 }
  if (!providers.length) return 4000
  return Math.min(...providers.map(provider => limits[provider] || 4000))
}

export function fitCampaignBody(body: string, providers: SocialProvider[]): string {
  const limit = campaignBodyLimit(providers)
  const value = body.trim()
  if (value.length <= limit) return value
  const candidate = value.slice(0, Math.max(1, limit - 1))
  const wordBoundary = candidate.lastIndexOf(' ')
  return `${candidate.slice(0, wordBoundary > limit * 0.7 ? wordBoundary : candidate.length).trimEnd()}…`
}

export class CampaignService {
  async list(): Promise<CampaignView[]> {
    const campaigns = await database.selectFrom('launch_campaigns').selectAll().orderBy('updated_at', 'desc').execute()
    if (!campaigns.length) return []

    const posts = await database
      .selectFrom('campaign_posts')
      .select(['launch_campaign_id', 'status'])
      .where('launch_campaign_id', 'in', campaigns.map((campaign: any) => campaign.id))
      .execute()

    return campaigns.map((campaign: any) => {
      const owned = posts.filter((post: any) => Number(post.launch_campaign_id) === Number(campaign.id))
      return campaignRow(campaign, { posts: owned.length, queued: owned.filter((post: any) => post.status === 'queued' || post.status === 'published').length })
    })
  }

  async get(id: number): Promise<{ campaign: CampaignView, posts: CampaignPostView[] }> {
    const row = await database.selectFrom('launch_campaigns').selectAll().where('id', '=', id).executeTakeFirst()
    if (!row) throw new Error('Campaign not found.')
    const posts = await database
      .selectFrom('campaign_posts')
      .selectAll()
      .where('launch_campaign_id', '=', id)
      .orderBy('scheduled_at', 'asc')
      .orderBy('position', 'asc')
      .execute()
    return {
      campaign: campaignRow(row, { posts: posts.length, queued: posts.filter((post: any) => post.status === 'queued' || post.status === 'published').length }),
      posts: posts.map(postRow),
    }
  }

  async create(input: CampaignInput): Promise<CampaignView> {
    const name = input.name.trim()
    if (name.length < 2) throw new Error('Give the campaign a name.')
    const startDate = assertDate(input.startDate, 'Campaign start')
    const endDate = assertDate(input.endDate, 'Campaign end')
    if (endDate < startDate) throw new Error('Campaign end must be on or after its start.')
    const accountId = await ensureAccount()
    const campaignUuid = uuid()
    const timestamp = now()
    const tone = input.tone && CAMPAIGN_TONES.includes(input.tone) ? input.tone : 'clear'

    await database.insertInto('launch_campaigns').values({
      uuid: campaignUuid,
      name,
      objective: input.objective?.trim() || null,
      audience: input.audience?.trim() || null,
      tone,
      status: 'draft',
      start_date: startDate,
      end_date: endDate,
      timezone: input.timezone?.trim() || env.TZ || 'America/Los_Angeles',
      account_id: accountId,
      created_at: timestamp,
      updated_at: timestamp,
    }).execute()

    const created = await database.selectFrom('launch_campaigns').selectAll().where('uuid', '=', campaignUuid).executeTakeFirstOrThrow()
    return campaignRow(created)
  }

  async update(id: number, input: Partial<CampaignInput> & { status?: string }): Promise<CampaignView> {
    const current = (await this.get(id)).campaign
    const startDate = input.startDate ? assertDate(input.startDate, 'Campaign start') : current.startDate
    const endDate = input.endDate ? assertDate(input.endDate, 'Campaign end') : current.endDate
    if (endDate < startDate) throw new Error('Campaign end must be on or after its start.')
    const statuses = ['draft', 'active', 'paused', 'completed', 'archived']
    const tones = CAMPAIGN_TONES as readonly string[]

    await database.updateTable('launch_campaigns').set({
      name: input.name?.trim() || current.name,
      objective: input.objective === undefined ? current.objective || null : input.objective?.trim() || null,
      audience: input.audience === undefined ? current.audience || null : input.audience?.trim() || null,
      tone: input.tone && tones.includes(input.tone) ? input.tone : current.tone,
      status: input.status && statuses.includes(input.status) ? input.status : current.status,
      start_date: startDate,
      end_date: endDate,
      timezone: input.timezone?.trim() || current.timezone,
      updated_at: now(),
    }).where('id', '=', id).execute()
    return (await this.get(id)).campaign
  }

  async savePost(input: CampaignPostInput): Promise<CampaignPostView> {
    await this.get(input.campaignId)
    const title = input.title.trim()
    const body = input.body.trim()
    const providers = normalizeProviders(input.providers)
    if (!title || !body) throw new Error('Post title and copy are required.')
    if (!providers.length) throw new Error('Select at least one social channel.')
    const pillar = input.pillar && CAMPAIGN_PILLARS.includes(input.pillar) ? input.pillar : 'story'
    const status = input.status && ['idea', 'ready', 'skipped'].includes(input.status) ? input.status : 'idea'
    const timestamp = now()
    const values = {
      title,
      body,
      providers: JSON.stringify(providers),
      pillar,
      status,
      scheduled_at: sqliteTimestamp(input.scheduledAt),
      position: Math.max(0, Math.round(input.position || 0)),
      updated_at: timestamp,
    }

    if (input.id) {
      const existing = await database.selectFrom('campaign_posts').selectAll().where('id', '=', input.id).where('launch_campaign_id', '=', input.campaignId).executeTakeFirst()
      if (!existing) throw new Error('Campaign post not found.')
      if (existing.post_id) throw new Error('Queued posts must be edited from the publishing queue.')
      await database.updateTable('campaign_posts').set(values).where('id', '=', input.id).execute()
      const updated = await database.selectFrom('campaign_posts').selectAll().where('id', '=', input.id).executeTakeFirstOrThrow()
      return postRow(updated)
    }

    const postUuid = uuid()
    await database.insertInto('campaign_posts').values({
      ...values,
      uuid: postUuid,
      launch_campaign_id: input.campaignId,
      post_id: null,
      created_at: timestamp,
    }).execute()
    const created = await database.selectFrom('campaign_posts').selectAll().where('uuid', '=', postUuid).executeTakeFirstOrThrow()
    return postRow(created)
  }

  async movePost(campaignId: number, id: number, scheduledAt: string, position = 0): Promise<CampaignPostView> {
    const existing = await database.selectFrom('campaign_posts').selectAll().where('id', '=', id).where('launch_campaign_id', '=', campaignId).executeTakeFirst()
    if (!existing) throw new Error('Campaign post not found.')
    if (existing.post_id) throw new Error('Queued posts must be rescheduled from the publishing queue.')
    await database.updateTable('campaign_posts').set({ scheduled_at: sqliteTimestamp(scheduledAt), position: Math.max(0, Math.round(position)), updated_at: now() }).where('id', '=', id).execute()
    const updated = await database.selectFrom('campaign_posts').selectAll().where('id', '=', id).executeTakeFirstOrThrow()
    return postRow(updated)
  }

  async removePost(campaignId: number, id: number): Promise<void> {
    const existing = await database.selectFrom('campaign_posts').select(['id', 'post_id']).where('id', '=', id).where('launch_campaign_id', '=', campaignId).executeTakeFirst()
    if (!existing) throw new Error('Campaign post not found.')
    if (existing.post_id) throw new Error('Queued posts must be removed from the publishing queue.')
    await database.deleteFrom('campaign_posts').where('id', '=', id).execute()
    await database.updateTable('launch_campaigns').set({ updated_at: now() }).where('id', '=', campaignId).execute()
  }

  async generate(id: number, input: { count?: number, providers?: SocialProvider[], direction?: string, strategy?: CampaignAIStrategy }): Promise<{
    posts: CampaignPostView[]
    mode: 'ai' | 'template'
    assistant: string
    provider: string
    model?: string
    promptAdjusted: boolean
    usage?: { promptTokens: number, completionTokens: number, totalTokens: number }
  }> {
    const { campaign, posts: existingPosts } = await this.get(id)
    const count = Math.max(3, Math.min(18, Math.round(input.count || 8)))
    const providers = normalizeProviders(input.providers)
    if (!providers.length) throw new Error('Select at least one social channel.')

    const fallback = buildCampaignFallbackPlan(campaign, count, providers, input.strategy, existingPosts)
    const plan = await campaignAI.plan({
      campaign: {
        name: campaign.name,
        objective: campaign.objective,
        audience: campaign.audience,
        tone: campaign.tone,
        startDate: campaign.startDate,
        endDate: campaign.endDate,
        existingPosts: existingPosts.map(post => ({
          title: post.title,
          pillar: post.pillar,
          scheduledAt: post.scheduledAt,
        })),
      },
      count,
      providers,
      direction: input.direction,
      strategy: input.strategy,
      fallback,
    })

    const usedBodies = new Set(existingPosts.map(post => post.body.trim().toLowerCase()))
    const suggestions = plan.suggestions.slice(0, count).map((suggestion) => ({
      ...suggestion,
      providers: normalizeProviders(suggestion.providers).filter(provider => providers.includes(provider)),
      body: fitCampaignBody(suggestion.body, providers),
    })).filter((suggestion) => {
      const body = suggestion.body?.trim().toLowerCase()
      if (!suggestion.title?.trim() || !body || !suggestion.providers.length || usedBodies.has(body)) return false
      usedBodies.add(body)
      return true
    })
    for (const suggestion of fallback) {
      if (suggestions.length >= count) break
      if (usedBodies.has(suggestion.body.trim().toLowerCase())) continue
      usedBodies.add(suggestion.body.trim().toLowerCase())
      suggestions.push(suggestion)
    }

    const campaignDays = Math.max(0, Math.floor((Date.parse(campaign.endDate) - Date.parse(campaign.startDate)) / 86400000))
    const timestamp = now()
    const rows = suggestions.slice(0, count).map((suggestion, index) => ({
      uuid: uuid(),
      launch_campaign_id: id,
      post_id: null,
      title: suggestion.title.trim().slice(0, 160),
      body: suggestion.body.trim().slice(0, 4000),
      providers: JSON.stringify(suggestion.providers.length ? suggestion.providers : providers),
      pillar: CAMPAIGN_PILLARS.includes(suggestion.pillar) ? suggestion.pillar : 'story',
      status: 'idea',
      scheduled_at: scheduleFromOffset(campaign.startDate, Math.min(campaignDays, suggestion.offsetDays), suggestion.time),
      position: index,
      created_at: timestamp,
      updated_at: timestamp,
    }))
    if (!rows.length) throw new Error('The campaign planner did not return any usable posts.')

    await database.insertInto('campaign_posts').values(rows).execute()
    const created = await database
      .selectFrom('campaign_posts')
      .selectAll()
      .where('uuid', 'in', rows.map(row => row.uuid))
      .orderBy('position', 'asc')
      .execute()
    await database.updateTable('launch_campaigns').set({ updated_at: timestamp }).where('id', '=', id).execute()
    return {
      posts: created.map(postRow),
      mode: plan.mode,
      assistant: plan.assistant,
      provider: plan.provider,
      model: plan.model,
      promptAdjusted: plan.promptAdjusted,
      usage: plan.usage,
    }
  }

  async activate(id: number): Promise<{ queued: number, skipped: number, errors: string[] }> {
    const { posts } = await this.get(id)
    let queued = 0
    let skipped = 0
    const errors: string[] = []

    for (const item of posts) {
      if (item.postId || item.status === 'skipped') {
        skipped++
        continue
      }
      try {
        const schedule = sqliteTimestamp(item.scheduledAt)
        if (schedule <= now()) throw new Error('time is in the past')
        const result = await postQueue.save({ text: item.body, title: item.title, providers: item.providers, scheduledAt: schedule })
        await database.updateTable('campaign_posts').set({ post_id: result.postId, status: 'queued', updated_at: now() }).where('id', '=', item.id).execute()
        queued++
      }
      catch (error) {
        errors.push(`${item.title}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    if (queued) await this.update(id, { status: 'active' })
    return { queued, skipped, errors }
  }
}

export const campaigns = new CampaignService()
