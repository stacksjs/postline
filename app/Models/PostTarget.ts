import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'PostTarget',
  table: 'post_targets',
  primaryKey: 'id',
  autoIncrement: true,

  indexes: [
    { name: 'post_targets_provider_status_index', columns: ['provider', 'status'] },
  ],

  traits: {
    useUuid: true,
    useTimestamps: true,
    useSeeder: { count: 18 },
    useApi: {
      uri: 'post-targets',
      routes: ['index', 'store', 'show', 'update', 'destroy'],
    },
  },

  belongsTo: ['Post', 'SocialDriver', 'SocialIdentity'],

  attributes: {
    provider: {
      required: true,
      fillable: true,
      validation: { rule: schema.enum(['bluesky', 'twitter', 'mastodon', 'facebook', 'instagram', 'tiktok', 'linkedin']).required() },
      factory: faker => faker.helpers.arrayElement(['bluesky', 'twitter', 'mastodon']),
    },
    status: {
      required: true,
      fillable: true,
      default: 'draft',
      validation: { rule: schema.enum(['draft', 'scheduled', 'publishing', 'published', 'failed', 'skipped']).required() },
      factory: faker => faker.helpers.arrayElement(['draft', 'scheduled', 'published', 'failed']),
    },
    scheduledAt: {
      required: false,
      fillable: true,
      validation: { rule: schema.timestamp().optional() },
      factory: faker => faker.date.soon({ days: 14 }).toISOString().slice(0, 19).replace('T', ' '),
    },
    remoteUri: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(500).optional() },
      factory: faker => faker.helpers.maybe(() => `at://${faker.string.alphanumeric(24)}/app.bsky.feed.post/${faker.string.alphanumeric(12)}`, { probability: 0.35 }) ?? null,
    },
    remoteCid: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(255).optional() },
      factory: faker => faker.helpers.maybe(() => faker.string.alphanumeric(42), { probability: 0.35 }) ?? null,
    },
    failureReason: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(1000).optional() },
      factory: faker => faker.helpers.maybe(() => faker.lorem.sentence(), { probability: 0.1 }) ?? null,
    },
    metrics: {
      required: false,
      fillable: true,
      validation: { rule: schema.json().optional() },
      factory: faker => JSON.stringify({
        likes: faker.number.int({ min: 0, max: 300 }),
        reposts: faker.number.int({ min: 0, max: 80 }),
        replies: faker.number.int({ min: 0, max: 40 }),
      }),
    },
  },
} as const)
