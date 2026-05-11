import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'TimelineItem',
  table: 'timeline_items',
  primaryKey: 'id',
  autoIncrement: true,

  indexes: [
    { name: 'timeline_items_provider_posted_at_index', columns: ['provider', 'posted_at'] },
  ],

  traits: {
    useUuid: true,
    useTimestamps: true,
    useSeeder: { count: 30 },
    useApi: {
      uri: 'timeline-items',
      routes: ['index', 'store', 'show', 'update', 'destroy'],
    },
  },

  belongsTo: ['SocialDriver', 'SocialIdentity'],

  attributes: {
    provider: {
      required: true,
      fillable: true,
      default: 'bluesky',
      validation: { rule: schema.enum(['bluesky', 'twitter', 'mastodon', 'facebook', 'instagram', 'tiktok', 'linkedin']).required() },
      factory: () => 'bluesky',
    },
    remoteUri: {
      required: true,
      unique: true,
      fillable: true,
      validation: { rule: schema.string().required().max(500) },
      factory: faker => `at://${faker.string.alphanumeric(24)}/app.bsky.feed.post/${faker.string.alphanumeric(12)}`,
    },
    authorHandle: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().max(120) },
      factory: faker => `${faker.string.alphanumeric(10).toLowerCase()}.bsky.social`,
    },
    authorName: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(120).optional() },
      factory: faker => faker.person.fullName(),
    },
    body: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().max(4000) },
      factory: faker => faker.lorem.sentences({ min: 1, max: 3 }),
    },
    postedAt: {
      required: true,
      fillable: true,
      validation: { rule: schema.timestamp().required() },
      factory: faker => faker.date.recent({ days: 7 }).toISOString().slice(0, 19).replace('T', ' '),
    },
    likeCount: {
      required: false,
      fillable: true,
      default: 0,
      validation: { rule: schema.number().min(0).optional() },
      factory: faker => faker.number.int({ min: 0, max: 2000 }),
    },
    repostCount: {
      required: false,
      fillable: true,
      default: 0,
      validation: { rule: schema.number().min(0).optional() },
      factory: faker => faker.number.int({ min: 0, max: 500 }),
    },
    replyCount: {
      required: false,
      fillable: true,
      default: 0,
      validation: { rule: schema.number().min(0).optional() },
      factory: faker => faker.number.int({ min: 0, max: 120 }),
    },
  },
} as const)
