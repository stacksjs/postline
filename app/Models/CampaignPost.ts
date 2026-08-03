import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/** One planned campaign touchpoint, optionally linked to a queued Post. */
export default defineModel({
  name: 'CampaignPost',
  table: 'campaign_posts',
  primaryKey: 'id',
  autoIncrement: true,

  indexes: [
    { name: 'campaign_posts_campaign_scheduled_at_index', columns: ['launch_campaign_id', 'scheduled_at'] },
    { name: 'campaign_posts_status_index', columns: ['status'] },
  ],

  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: {
      uri: 'campaign-posts',
      routes: ['index', 'show'],
    },
  },

  belongsTo: ['LaunchCampaign', 'Post'],

  attributes: {
    title: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().min(1).max(160) },
      factory: faker => faker.lorem.words(4),
    },
    body: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().min(1).max(4000) },
      factory: faker => faker.lorem.sentences({ min: 1, max: 3 }),
    },
    providers: {
      required: true,
      fillable: true,
      validation: { rule: schema.json().required() },
      factory: () => JSON.stringify(['bluesky', 'linkedin']),
    },
    pillar: {
      required: true,
      fillable: true,
      default: 'story',
      validation: { rule: schema.enum(['teaser', 'story', 'education', 'proof', 'launch', 'follow-up']).required() },
      factory: faker => faker.helpers.arrayElement(['teaser', 'story', 'education', 'proof', 'launch', 'follow-up']),
    },
    status: {
      required: true,
      fillable: true,
      default: 'idea',
      validation: { rule: schema.enum(['idea', 'ready', 'queued', 'published', 'skipped']).required() },
      factory: () => 'idea',
    },
    scheduledAt: {
      required: true,
      fillable: true,
      validation: { rule: schema.timestamp().required() },
      factory: faker => faker.date.soon({ days: 35 }).toISOString().slice(0, 19).replace('T', ' '),
    },
    position: {
      required: true,
      fillable: true,
      default: 0,
      validation: { rule: schema.number().min(0).required() },
      factory: faker => faker.number.int({ min: 0, max: 12 }),
    },
  },
} as const)
