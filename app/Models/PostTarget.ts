import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'PostTarget',
  table: 'post_targets',
  primaryKey: 'id',
  autoIncrement: true,

  indexes: [
    { name: 'post_targets_provider_status_index', columns: ['provider', 'status'] },
    // Every queue row reads its targets by post, and with thousands of
    // posts that was a scan of the whole table per row.
    { name: 'post_targets_post_id_index', columns: ['post_id'] },
    // The scheduler asks each minute which failed targets are due again.
    { name: 'post_targets_status_next_attempt_at_index', columns: ['status', 'next_attempt_at'] },
    { name: 'post_targets_first_comment_status_index', columns: ['first_comment_status', 'first_comment_started_at'] },
  ],

  traits: {
    useUuid: true,
    useTimestamps: true,
    useSeeder: { count: 18 },
  },

  belongsTo: ['Post', 'SocialDriver', 'SocialIdentity'],

  attributes: {
    provider: {
      required: true,
      fillable: true,
      // Mirrors `SocialProvider` in app/Support/Social/types.ts. The generated
      // CHECK constraint comes from this list, so a provider added to the union
      // without being added here fails at insert rather than at compile time.
      // `opentimes` is not a network Postline publishes to. It stays allowed
      // because the table's constraint has allowed it since the Open Times
      // era and databases from then still hold rows with it; narrowing the
      // list would make the table rebuild fail on exactly those databases.
      validation: { rule: schema.enum(['bluesky', 'twitter', 'mastodon', 'facebook', 'instagram', 'tiktok', 'linkedin', 'threads', 'blog', 'opentimes']).required() },
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
    remoteUrl: {
      required: false,
      validation: { rule: schema.string().optional() },
      factory: () => null,
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
    // The portable account reference of a restored target until it can bind to
    // a local identity. A missing local row must never imply the default.
    archivedAccount: {
      required: false,
      validation: { rule: schema.string().optional() },
      factory: () => null,
    },
    firstCommentBody: {
      required: false,
      validation: { rule: schema.string().optional() },
      factory: () => null,
    },
    firstCommentStatus: {
      required: false,
      validation: { rule: schema.enum(['pending', 'sending', 'sent', 'failed', 'uncertain']).optional() },
      factory: () => null,
    },
    firstCommentStartedAt: {
      required: false,
      validation: { rule: schema.timestamp().optional() },
      factory: () => null,
    },
    firstCommentRemoteId: {
      required: false,
      validation: { rule: schema.string().optional() },
      factory: () => null,
    },
    firstCommentError: {
      required: false,
      validation: { rule: schema.string().optional() },
      factory: () => null,
    },
    // How many times this target has been sent and failed, and when it is
    // sent again. A null `nextAttemptAt` on a failed target means it will
    // not be retried: the network refused it, or it ran out of attempts.
    attempts: {
      required: false,
      fillable: true,
      default: 0,
      validation: { rule: schema.number().min(0).optional() },
      factory: () => 0,
    },
    nextAttemptAt: {
      required: false,
      fillable: true,
      validation: { rule: schema.timestamp().optional() },
      factory: () => null,
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
