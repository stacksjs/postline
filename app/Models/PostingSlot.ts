import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'PostingSlot',
  table: 'posting_slots',
  primaryKey: 'id',
  autoIncrement: true,
  belongsTo: ['Account'],
  indexes: [{ name: 'posting_slots_network_weekday_minute_unique', columns: ['account_id', 'provider', 'weekday', 'minute'], unique: true }],
  attributes: {
    provider: { required: true, validation: { rule: schema.string().required().max(24) } },
    weekday: { required: true, validation: { rule: schema.number().min(0).max(6) } },
    minute: { required: true, validation: { rule: schema.number().min(0).max(1439) } },
  },
} as const)
