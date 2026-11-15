import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/** A saved social-listening rule that periodically searches connected networks. */
export default defineModel({
  name: 'KeywordMonitor',
  table: 'keyword_monitors',
  primaryKey: 'id',
  autoIncrement: true,

  indexes: [
    { name: 'keyword_monitors_status_last_checked_at_index', columns: ['status', 'last_checked_at'] },
  ],

  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: {
      uri: 'keyword-monitors',
      routes: ['index', 'show'],
      middleware: ['auth'],
    },
  },

  belongsTo: ['Account'],
  hasMany: ['KeywordMention'],

  attributes: {
    name: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().min(2).max(120) },
      factory: () => 'Brand mentions',
    },
    keywords: {
      required: true,
      fillable: true,
      validation: { rule: schema.json().required() },
      factory: () => JSON.stringify(['Postline', 'Stacks']),
    },
    providers: {
      required: true,
      fillable: true,
      validation: { rule: schema.json().required() },
      factory: () => JSON.stringify(['bluesky', 'twitter']),
    },
    matchMode: {
      required: true,
      fillable: true,
      default: 'any',
      validation: { rule: schema.enum(['any', 'all', 'phrase']).required() },
      factory: () => 'any',
    },
    status: {
      required: true,
      fillable: true,
      default: 'active',
      validation: { rule: schema.enum(['active', 'paused']).required() },
      factory: () => 'active',
    },
    lastCheckedAt: {
      required: false,
      fillable: true,
      validation: { rule: schema.timestamp().optional() },
      factory: () => null,
    },
    lastError: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(2000).optional() },
      factory: () => null,
    },
  },
} as const)
