import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'InboxMention',
  table: 'inbox_mentions',
  primaryKey: 'id',
  autoIncrement: true,
  indexes: [
    { name: 'inbox_mentions_identity_remote_unique', columns: ['social_identity_id', 'remote_id'], unique: true },
    { name: 'inbox_mentions_posted_at_index', columns: ['posted_at', 'id'] },
  ],
  traits: { useUuid: true, useTimestamps: true },
  belongsTo: ['SocialIdentity'],
  attributes: {
    remoteId: { required: true, validation: { rule: schema.string().max(700).required() } },
    kind: { required: true, validation: { rule: schema.enum(['reply', 'mention']).required() } },
    author: { required: true, validation: { rule: schema.string().max(255).required() } },
    body: { required: false, validation: { rule: schema.string().max(10000).optional() } },
    url: { required: true, validation: { rule: schema.string().max(1000).required() } },
    postedAt: { required: true, validation: { rule: schema.timestamp().required() } },
    readAt: { required: false, validation: { rule: schema.timestamp().optional() } },
  },
} as const)
