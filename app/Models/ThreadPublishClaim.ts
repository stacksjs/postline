import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'ThreadPublishClaim',
  table: 'thread_publish_claims',
  primaryKey: 'id',
  autoIncrement: true,
  indexes: [{ name: 'thread_publish_claims_thread_key_unique', columns: ['thread_key'], unique: true }],
  traits: { useUuid: true, useTimestamps: true },
  attributes: {
    threadKey: {
      required: true,
      validation: { rule: schema.string().required() },
    },
  },
} as const)
