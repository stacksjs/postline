import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'
import { RECURRENCE_INTERVALS } from '../Support/Social/recurring-posts'

export default defineModel({
  name: 'RecurringPost',
  table: 'recurring_posts',
  primaryKey: 'id',
  autoIncrement: true,
  belongsTo: ['Account'],
  traits: { useUuid: true, useTimestamps: true },
  indexes: [{ name: 'recurring_posts_active_next_at_index', columns: ['active', 'next_at'] }],
  attributes: {
    title: { required: true, validation: { rule: schema.string().required().max(160) } },
    template: { required: true, validation: { rule: schema.json().required() } },
    interval: { required: true, validation: { rule: schema.enum(RECURRENCE_INTERVALS).required() } },
    startsAt: { required: true, validation: { rule: schema.timestamp().required() } },
    nextAt: { required: true, validation: { rule: schema.timestamp().required() } },
    timezone: { required: true, validation: { rule: schema.string().required().max(80) } },
    active: { required: true, default: true, validation: { rule: schema.boolean() } },
    lastError: { required: false, validation: { rule: schema.string().max(300).optional() } },
  },
} as const)
