import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'SocialIdentity',
  table: 'social_identities',
  primaryKey: 'id',
  autoIncrement: true,

  traits: {
    useUuid: true,
    useTimestamps: true,
    useSeeder: { count: 3 },
    useApi: {
      uri: 'social-identities',
      routes: ['index', 'store', 'show', 'update', 'destroy'],
    },
  },

  belongsTo: ['Account', 'SocialDriver'],
  hasMany: ['PostTarget', 'TimelineItem'],

  attributes: {
    handle: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().min(3).max(120) },
      factory: faker => `${faker.string.alphanumeric(10).toLowerCase()}.bsky.social`,
    },
    displayName: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(120).optional() },
      factory: faker => faker.person.fullName(),
    },
    provider: {
      required: true,
      fillable: true,
      default: 'bluesky',
      validation: { rule: schema.enum(['bluesky', 'twitter', 'mastodon', 'facebook', 'instagram', 'tiktok', 'linkedin']).required() },
      factory: () => 'bluesky',
    },
    externalId: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(255).optional() },
      factory: faker => `did:plc:${faker.string.alphanumeric(24).toLowerCase()}`,
    },
    authStatus: {
      required: true,
      fillable: true,
      default: 'connected',
      validation: { rule: schema.enum(['connected', 'expired', 'revoked', 'missing']).required() },
      factory: faker => faker.helpers.arrayElement(['connected', 'connected', 'missing']),
    },
    accessToken: {
      required: false,
      hidden: true,
      fillable: true,
      validation: { rule: schema.string().max(4000).optional() },
      factory: () => null,
    },
    refreshToken: {
      required: false,
      hidden: true,
      fillable: true,
      validation: { rule: schema.string().max(4000).optional() },
      factory: () => null,
    },
  },
} as const)
