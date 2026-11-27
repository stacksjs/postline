import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'TrackedLink',
  table: 'tracked_links',
  primaryKey: 'id',
  autoIncrement: true,
  indexes: [{ name: 'tracked_links_code_unique', columns: ['code'], unique: true }],
  traits: { useTimestamps: true },
  belongsTo: ['Account'],
  attributes: {
    code: {
      required: true,
      validation: { rule: schema.string().required().length(16) },
    },
    name: {
      required: true,
      validation: { rule: schema.string().required().max(100) },
    },
    destination: {
      required: true,
      validation: { rule: schema.string().required().max(4096) },
    },
    visits: {
      required: true,
      default: 0,
      validation: { rule: schema.number().min(0) },
    },
    disabled: {
      required: true,
      default: false,
      validation: { rule: schema.boolean() },
    },
  },
} as const)
