import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * Something the owner should know about and may have missed: a post that
 * failed and will not be retried, a post that was held back as too late, a
 * network sign-in that was refused.
 *
 * `dedupeKey` keeps one alert per thing: the scheduler meets the same failed
 * post every minute and must not say so every minute.
 */
export default defineModel({
  name: 'Alert',
  table: 'alerts',
  primaryKey: 'id',
  autoIncrement: true,

  indexes: [
    { name: 'alerts_dedupe_key_unique', columns: ['dedupe_key'], unique: true },
    { name: 'alerts_read_at_index', columns: ['read_at'] },
  ],

  traits: {
    useTimestamps: true,
  },

  attributes: {
    kind: {
      required: true,
      fillable: true,
      validation: { rule: schema.enum(['post-failed', 'post-missed', 'account-expired', 'keyword-match']).required() },
      factory: () => 'post-failed',
    },
    title: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().max(200) },
      factory: () => 'A post failed on Mastodon',
    },
    body: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(1000).optional() },
      factory: () => null,
    },
    link: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(255).optional() },
      factory: () => '/queue',
    },
    dedupeKey: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().max(190) },
      factory: faker => faker.string.uuid(),
    },
    readAt: {
      required: false,
      fillable: true,
      validation: { rule: schema.timestamp().optional() },
      factory: () => null,
    },
  },
} as const)
