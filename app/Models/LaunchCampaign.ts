import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * A social launch plan. Kept separate from Stacks' email-oriented Campaign
 * model so Postline can evolve its planning workflow without coupling it to
 * newsletter delivery.
 */
export default defineModel({
  name: 'LaunchCampaign',
  table: 'launch_campaigns',
  primaryKey: 'id',
  autoIncrement: true,

  indexes: [
    { name: 'launch_campaigns_status_start_date_index', columns: ['status', 'start_date'] },
  ],

  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: {
      uri: 'launch-campaigns',
      routes: ['index', 'show'],
    },
  },

  belongsTo: ['Account'],
  hasMany: ['CampaignPost'],

  attributes: {
    name: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().min(2).max(120) },
      factory: faker => faker.helpers.arrayElement(['Spring launch', 'Product week', 'Community release']),
    },
    objective: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(1200).optional() },
      factory: faker => faker.lorem.paragraph(),
    },
    audience: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(500).optional() },
      factory: faker => faker.lorem.sentence(),
    },
    tone: {
      required: true,
      fillable: true,
      default: 'clear',
      validation: { rule: schema.enum(['clear', 'bold', 'warm', 'technical', 'playful']).required() },
      factory: faker => faker.helpers.arrayElement(['clear', 'bold', 'warm', 'technical']),
    },
    status: {
      required: true,
      fillable: true,
      default: 'draft',
      validation: { rule: schema.enum(['draft', 'active', 'paused', 'completed', 'archived']).required() },
      factory: () => 'draft',
    },
    startDate: {
      required: true,
      fillable: true,
      validation: { rule: schema.timestamp().required() },
      factory: () => new Date().toISOString().slice(0, 10),
    },
    endDate: {
      required: true,
      fillable: true,
      validation: { rule: schema.timestamp().required() },
      factory: () => new Date(Date.now() + 35 * 86400000).toISOString().slice(0, 10),
    },
    timezone: {
      required: true,
      fillable: true,
      default: 'America/Los_Angeles',
      validation: { rule: schema.string().required().max(80) },
      factory: () => 'America/Los_Angeles',
    },
  },
} as const)
