import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/** The projected X API read charges reserved by this workspace per UTC day. */
export default defineModel({
  name: 'TwitterReadUsage',
  table: 'twitter_read_usage',
  primaryKey: 'id',
  autoIncrement: true,

  indexes: [
    { name: 'twitter_read_usage_day_unique', columns: ['day'], unique: true },
  ],

  attributes: {
    day: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().min(10).max(10) },
      factory: () => new Date().toISOString().slice(0, 10),
    },
    estimatedMicros: {
      required: true,
      fillable: true,
      default: 0,
      validation: { rule: schema.number().required().min(0) },
      factory: () => 0,
    },
  },
} as const)
