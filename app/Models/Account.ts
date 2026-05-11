import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'Account',
  table: 'accounts',
  primaryKey: 'id',
  autoIncrement: true,

  traits: {
    useUuid: true,
    useTimestamps: true,
    useSeeder: { count: 1 },
    useApi: {
      uri: 'accounts',
      routes: ['index', 'store', 'show', 'update', 'destroy'],
    },
  },

  hasMany: ['SocialIdentity', 'Post'],

  attributes: {
    name: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().min(2).max(120) },
      factory: () => 'Chris Breuer',
    },
    workspaceName: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().min(2).max(120) },
      factory: () => 'Postline',
    },
    timezone: {
      required: true,
      fillable: true,
      default: 'America/Los_Angeles',
      validation: { rule: schema.string().required().max(80) },
      factory: () => 'America/Los_Angeles',
    },
    defaultAudience: {
      required: true,
      fillable: true,
      default: 'public',
      validation: { rule: schema.enum(['public', 'followers', 'private']).required() },
      factory: () => 'public',
    },
  },
} as const)
