import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * Audit trail for bulk post deletions. Every purge — preview or execute —
 * writes one row so a destructive run is never invisible after the fact.
 */
export default defineModel({
  name: 'PurgeRun',
  table: 'purge_runs',
  primaryKey: 'id',
  autoIncrement: true,

  indexes: [
    { name: 'purge_runs_provider_created_at_index', columns: ['provider', 'created_at'] },
  ],

  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: {
      uri: 'purge-runs',
      // Read-only: an audit row is written by the purge itself and must not be
      // editable or removable through the API.
      routes: ['index', 'show'],
    },
  },

  belongsTo: ['Account'],

  attributes: {
    provider: {
      required: true,
      fillable: true,
      // Mirrors `SocialProvider` in app/Support/Social/types.ts. The generated
      // CHECK constraint comes from this list, so a provider added to the union
      // without being added here fails at insert rather than at compile time.
      validation: { rule: schema.enum(['bluesky', 'twitter', 'mastodon', 'facebook', 'instagram', 'tiktok', 'linkedin', 'threads', 'blog', 'opentimes']).required() },
      factory: faker => faker.helpers.arrayElement(['bluesky', 'twitter', 'mastodon']),
    },
    handle: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(120).optional() },
      factory: faker => `${faker.string.alphanumeric(10).toLowerCase()}.bsky.social`,
    },
    scope: {
      required: true,
      fillable: true,
      default: 'tracked',
      validation: { rule: schema.enum(['tracked', 'all']).required() },
      factory: () => 'tracked',
    },
    mode: {
      required: true,
      fillable: true,
      default: 'preview',
      validation: { rule: schema.enum(['preview', 'execute']).required() },
      factory: () => 'preview',
    },
    status: {
      required: true,
      fillable: true,
      default: 'previewed',
      validation: { rule: schema.enum(['previewed', 'completed', 'partial', 'failed', 'skipped']).required() },
      factory: () => 'previewed',
    },
    matchedCount: {
      required: false,
      fillable: true,
      default: 0,
      validation: { rule: schema.number().min(0).optional() },
      factory: faker => faker.number.int({ min: 0, max: 500 }),
    },
    deletedCount: {
      required: false,
      fillable: true,
      default: 0,
      validation: { rule: schema.number().min(0).optional() },
      factory: () => 0,
    },
    failedCount: {
      required: false,
      fillable: true,
      default: 0,
      validation: { rule: schema.number().min(0).optional() },
      factory: () => 0,
    },
    /** Deleted URIs and per-post failures, so a run stays reconstructable. */
    details: {
      required: false,
      fillable: true,
      validation: { rule: schema.json().optional() },
      factory: () => JSON.stringify({ deleted: [], failed: [] }),
    },
    failureReason: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(1000).optional() },
      factory: () => null,
    },
    finishedAt: {
      required: false,
      fillable: true,
      validation: { rule: schema.timestamp().optional() },
      factory: () => null,
    },
  },
} as const)
