import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'DraftFeed',
  table: 'draft_feeds',
  primaryKey: 'id',
  autoIncrement: true,
  traits: { useUuid: true, useTimestamps: true },
  belongsTo: ['Account'],
  hasMany: ['DraftFeedEntry'],
  indexes: [{ name: 'draft_feeds_account_url_unique', columns: ['account_id', 'url'], unique: true }],
  attributes: {
    name: { required: true, validation: { rule: schema.string().required().max(120) } },
    url: { required: true, validation: { rule: schema.string().required().max(2048) } },
    active: { required: true, default: true, validation: { rule: schema.boolean() } },
    initialized: { required: true, default: false, validation: { rule: schema.boolean() } },
    lastCheckedAt: { required: false, validation: { rule: schema.timestamp().optional() } },
    lastError: { required: false, validation: { rule: schema.string().max(300).optional() } },
  },
} as const)
