import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'Post',
  table: 'posts',
  primaryKey: 'id',
  autoIncrement: true,

  indexes: [
    { name: 'posts_status_scheduled_at_index', columns: ['status', 'scheduled_at'] },
  ],

  traits: {
    useUuid: true,
    useTimestamps: true,
    useSeeder: { count: 12 },
    useSearch: {
      displayable: ['title', 'body', 'status', 'scheduled_at'],
      searchable: ['title', 'body'],
      sortable: ['scheduled_at', 'created_at', 'updated_at'],
      filterable: ['status'],
    },
    useApi: {
      uri: 'posts',
      routes: ['index', 'store', 'show', 'update', 'destroy'],
    },
  },

  belongsTo: ['Account'],
  hasMany: ['PostTarget', 'MediaAsset'],

  attributes: {
    title: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(160).optional() },
      factory: faker => faker.helpers.arrayElement(['Launch note', 'Product thought', 'Weekend recap', 'Thread idea']),
    },
    body: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().min(1).max(4000) },
      factory: faker => faker.lorem.sentences({ min: 1, max: 3 }),
    },
    status: {
      required: true,
      fillable: true,
      default: 'draft',
      validation: { rule: schema.enum(['draft', 'scheduled', 'publishing', 'published', 'failed', 'archived']).required() },
      factory: faker => faker.helpers.arrayElement(['draft', 'scheduled', 'published']),
    },
    scheduledAt: {
      required: false,
      fillable: true,
      validation: { rule: schema.timestamp().optional() },
      factory: faker => faker.date.soon({ days: 14 }).toISOString().slice(0, 19).replace('T', ' '),
    },
    publishedAt: {
      required: false,
      fillable: true,
      validation: { rule: schema.timestamp().optional() },
      factory: faker => faker.helpers.maybe(() => faker.date.recent({ days: 10 }).toISOString().slice(0, 19).replace('T', ' '), { probability: 0.35 }) ?? null,
    },
    timezone: {
      required: true,
      fillable: true,
      default: 'America/Los_Angeles',
      validation: { rule: schema.string().required().max(80) },
      factory: () => 'America/Los_Angeles',
    },
    threadKey: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(120).optional() },
      factory: faker => faker.helpers.maybe(() => faker.string.uuid(), { probability: 0.25 }) ?? null,
    },
    source: {
      required: true,
      fillable: true,
      default: 'composer',
      validation: { rule: schema.enum(['composer', 'import', 'api']).required() },
      factory: () => 'composer',
    },
    notes: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(1000).optional() },
      factory: faker => faker.helpers.maybe(() => faker.lorem.sentence(), { probability: 0.3 }) ?? null,
    },
  },
} as const)
