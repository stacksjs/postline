import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'SocialDriver',
  table: 'social_drivers',
  primaryKey: 'id',
  autoIncrement: true,

  traits: {
    useUuid: true,
    useTimestamps: true,
    useSeeder: { count: 8 },
    useApi: {
      uri: 'social-drivers',
      routes: ['index', 'store', 'show', 'update', 'destroy'],
    },
  },

  hasMany: ['SocialIdentity', 'PostTarget', 'TimelineItem'],

  attributes: {
    provider: {
      required: true,
      unique: true,
      fillable: true,
      validation: {
        rule: schema.enum(['bluesky', 'twitter', 'mastodon', 'facebook', 'instagram', 'tiktok', 'linkedin', 'threads']).required(),
      },
      // Only the providers that have a driver. The validation above still
      // accepts the framework's whole list, but seeding a `facebook` or
      // `tiktok` row invented a connection the app has no way to publish
      // through — nothing maps those to a driver, so the row was a decoy in
      // every listing that read it.
      factory: faker => faker.helpers.arrayElement(['bluesky', 'twitter', 'mastodon', 'instagram', 'linkedin', 'threads']),
    },
    displayName: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().min(2).max(80) },
      factory: faker => faker.helpers.arrayElement(['Bluesky', 'Twitter/X', 'Mastodon', 'Facebook', 'Instagram', 'TikTok', 'LinkedIn', 'Threads']),
    },
    status: {
      required: true,
      fillable: true,
      default: 'planned',
      validation: { rule: schema.enum(['active', 'planned', 'disabled']).required() },
      factory: faker => faker.helpers.arrayElement(['active', 'planned', 'planned']),
    },
    characterLimit: {
      required: true,
      fillable: true,
      default: 300,
      validation: { rule: schema.number().min(1).max(10000).required() },
      factory: faker => faker.helpers.arrayElement([300, 280, 500, 2200]),
    },
    capabilities: {
      required: false,
      fillable: true,
      validation: { rule: schema.json().optional() },
      factory: () => JSON.stringify({ posts: true, threads: true, images: true, timelines: true }),
    },
  },
} as const)
