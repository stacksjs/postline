import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'PostSubmission',
  table: 'post_submissions',
  primaryKey: 'id',
  autoIncrement: true,
  indexes: [{ name: 'post_submissions_request_key_unique', columns: ['request_key'], unique: true }],
  traits: { useTimestamps: true },
  attributes: {
    requestKey: {
      required: true,
      validation: { rule: schema.string().required().length(64) },
    },
    fingerprint: {
      required: true,
      validation: { rule: schema.string().required().length(64) },
    },
    // Retain the original response even after the post is edited or removed.
    receipt: {
      required: true,
      validation: { rule: schema.string().required().max(512) },
    },
  },
} as const)
