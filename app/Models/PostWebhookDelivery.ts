import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'PostWebhookDelivery',
  table: 'post_webhook_deliveries',
  primaryKey: 'id',
  autoIncrement: true,
  indexes: [
    { name: 'post_webhook_deliveries_ready_index', columns: ['destination_key', 'status', 'available_at'] },
  ],
  traits: { useUuid: true, useTimestamps: true },
  attributes: {
    destinationKey: { required: true, validation: { rule: schema.string().required().length(64) } },
    payload: { required: true, validation: { rule: schema.string().required().max(8192) } },
    status: { required: true, validation: { rule: schema.enum(['pending', 'delivered', 'failed']).required() } },
    attempts: { required: true, default: 0, validation: { rule: schema.number().min(0) } },
    availableAt: { required: true, validation: { rule: schema.timestamp().required() } },
    lease: { required: false, nullable: true, validation: { rule: schema.string().max(36).optional() } },
    failure: { required: false, nullable: true, validation: { rule: schema.string().max(120).optional() } },
  },
} as const)
