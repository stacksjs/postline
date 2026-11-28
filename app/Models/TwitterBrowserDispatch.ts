import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'TwitterBrowserDispatch',
  table: 'twitter_browser_dispatches',
  primaryKey: 'id',
  autoIncrement: true,
  indexes: [
    { name: 'twitter_browser_dispatches_post_handle_unique', columns: ['post_id', 'handle'], unique: true },
  ],
  belongsTo: [{ model: 'Post', onDelete: 'cascade' }],
  traits: { useUuid: true, useTimestamps: true },
  attributes: {
    handle: {
      required: true,
      validation: { rule: schema.string().max(15).required() },
    },
    state: {
      required: true,
      validation: { rule: schema.enum(['submitting', 'published', 'refused']).required() },
    },
    batchToken: {
      required: false,
      hidden: true,
      validation: { rule: schema.string().max(36).optional() },
    },
    deleteToken: {
      required: false,
      hidden: true,
      validation: { rule: schema.string().max(36).optional() },
    },
    deletedAt: {
      required: false,
      validation: { rule: schema.timestamp().optional() },
    },
    remoteId: {
      required: false,
      validation: { rule: schema.string().max(19).optional() },
    },
  },
} as const)
