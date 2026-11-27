import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'SocialOperationLease',
  table: 'social_operation_leases',
  primaryKey: 'id',
  autoIncrement: true,
  indexes: [{ name: 'social_operation_leases_key_unique', columns: ['lease_key'], unique: true }],
  traits: { useUuid: true, useTimestamps: true },
  attributes: {
    leaseKey: {
      required: true,
      validation: { rule: schema.string().required() },
    },
    expiresAt: {
      required: true,
      validation: { rule: schema.timestamp().required() },
    },
  },
} as const)
