import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/** A deduplicated post found by one keyword-monitor scan. */
export default defineModel({
  name: 'KeywordMention',
  table: 'keyword_mentions',
  primaryKey: 'id',
  autoIncrement: true,

  indexes: [
    { name: 'keyword_mentions_monitor_provider_uri_unique', columns: ['keyword_monitor_id', 'provider', 'remote_uri'], unique: true },
    { name: 'keyword_mentions_status_posted_at_index', columns: ['status', 'posted_at'] },
  ],

  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: {
      uri: 'keyword-mentions',
      routes: ['index', 'show'],
      middleware: ['auth'],
    },
  },

  belongsTo: ['KeywordMonitor'],

  attributes: {
    provider: {
      required: true,
      fillable: true,
      validation: { rule: schema.enum(['bluesky', 'twitter', 'mastodon']).required() },
      factory: () => 'bluesky',
    },
    remoteUri: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().max(700) },
      factory: faker => `at://${faker.string.alphanumeric(24)}/app.bsky.feed.post/${faker.string.alphanumeric(12)}`,
    },
    url: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().max(1000) },
      factory: () => 'https://bsky.app',
    },
    authorHandle: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().max(200) },
      factory: faker => `${faker.string.alphanumeric(8)}.bsky.social`,
    },
    authorName: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(200).optional() },
      factory: faker => faker.person.fullName(),
    },
    body: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().max(10000) },
      factory: faker => faker.lorem.sentences(2),
    },
    matchedKeywords: {
      required: true,
      fillable: true,
      validation: { rule: schema.json().required() },
      factory: () => JSON.stringify(['Postline']),
    },
    status: {
      required: true,
      fillable: true,
      default: 'unread',
      validation: { rule: schema.enum(['unread', 'read']).required() },
      factory: () => 'unread',
    },
    postedAt: {
      required: true,
      fillable: true,
      validation: { rule: schema.timestamp().required() },
      factory: () => new Date().toISOString().slice(0, 19).replace('T', ' '),
    },
  },
} as const)
