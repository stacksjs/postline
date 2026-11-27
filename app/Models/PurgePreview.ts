import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'PurgePreview',
  table: 'purge_previews',
  primaryKey: 'id',
  autoIncrement: true,
  indexes: [{ name: 'purge_previews_expires_at_index', columns: ['expires_at'] }],
  traits: { useUuid: true, useTimestamps: true },
  attributes: {
    snapshot: {
      required: true,
      validation: { rule: schema.json().required() },
    },
    expiresAt: {
      required: true,
      validation: { rule: schema.timestamp().required() },
    },
  },
} as const)
