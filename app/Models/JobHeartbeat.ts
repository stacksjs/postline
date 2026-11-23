import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * One row per recurring job: when it last ran, how long it took and how it
 * ended. It is how the app, and a health check, can tell that the scheduler
 * has stopped: nothing else changes when it does, posts simply stay queued.
 */
export default defineModel({
  name: 'JobHeartbeat',
  table: 'job_heartbeats',
  primaryKey: 'id',
  autoIncrement: true,

  indexes: [
    { name: 'job_heartbeats_job_unique', columns: ['job'], unique: true },
  ],

  traits: {
    useTimestamps: true,
  },

  attributes: {
    job: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().max(120) },
      factory: () => 'PublishScheduledPosts',
    },
    lastStartedAt: {
      required: false,
      fillable: true,
      validation: { rule: schema.timestamp().optional() },
      factory: () => null,
    },
    lastFinishedAt: {
      required: false,
      fillable: true,
      validation: { rule: schema.timestamp().optional() },
      factory: () => null,
    },
    lastDurationMs: {
      required: false,
      fillable: true,
      validation: { rule: schema.number().min(0).optional() },
      factory: () => 0,
    },
    lastStatus: {
      required: false,
      fillable: true,
      validation: { rule: schema.enum(['running', 'ok', 'failed']).optional() },
      factory: () => 'ok',
    },
    lastError: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(1000).optional() },
      factory: () => null,
    },
    runs: {
      required: false,
      fillable: true,
      default: 0,
      validation: { rule: schema.number().min(0).optional() },
      factory: () => 0,
    },
  },
} as const)
