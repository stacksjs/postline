import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * One newsletter send.
 *
 * A send is a row rather than a fire-and-forget loop because delivering to a
 * real list takes longer than a request, can fail halfway, and must never
 * double-send when retried. The row is the cursor: `delivered_count` advances
 * as batches complete, so a resumed job knows where it got to.
 *
 * Recipients are resolved at send time, not at publish time. A reader who
 * subscribes between the two should get the post; one who leaves should not.
 */
export default defineModel({
  name: 'PublicationSend',
  table: 'publication_sends',
  primaryKey: 'id',
  autoIncrement: true,

  indexes: [
    { name: 'publication_sends_status_created_index', columns: ['status', 'created_at'] },
    { name: 'publication_sends_source_unique', columns: ['publication_id', 'source_key'], unique: true },
  ],

  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: {
      uri: 'publication-sends',
      routes: ['index', 'show'],
      middleware: ['auth'],
    },
  },

  belongsTo: ['Publication', 'Post'],

  attributes: {
    /** Stable per-publication key for the post, so a republish cannot double-send. */
    sourceKey: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().max(255) },
      factory: faker => `blog:${faker.lorem.slug()}`,
    },
    subject: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().max(300) },
      factory: faker => faker.lorem.sentence({ min: 4, max: 9 }),
    },
    body: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().min(1) },
      factory: faker => faker.lorem.paragraphs(3),
    },
    url: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(1000).optional() },
      factory: () => null,
    },
    /** Who receives it. `paid` is how a paywalled post reaches only payers. */
    audience: {
      required: true,
      fillable: true,
      default: 'everyone',
      validation: { rule: schema.enum(['everyone', 'paid']).required() },
      factory: () => 'everyone',
    },
    status: {
      required: true,
      fillable: true,
      default: 'queued',
      validation: { rule: schema.enum(['queued', 'sending', 'sent', 'failed']).required() },
      factory: () => 'queued',
    },
    recipientCount: {
      required: true,
      fillable: true,
      default: 0,
      validation: { rule: schema.number().min(0).required() },
      factory: faker => faker.number.int({ min: 0, max: 500 }),
    },
    deliveredCount: {
      required: true,
      fillable: true,
      default: 0,
      validation: { rule: schema.number().min(0).required() },
      factory: () => 0,
    },
    failedCount: {
      required: true,
      fillable: true,
      default: 0,
      validation: { rule: schema.number().min(0).required() },
      factory: () => 0,
    },
    lastError: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(2000).optional() },
      factory: () => null,
    },
    sentAt: {
      required: false,
      fillable: true,
      validation: { rule: schema.timestamp().optional() },
      factory: () => null,
    },
  },
} as const)
