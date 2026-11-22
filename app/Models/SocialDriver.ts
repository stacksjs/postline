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
    // One row per network Postline can publish to, written out rather than
    // generated. `provider` is unique and an enum: a random pick collides, and
    // the seeder's answer to a collision is a suffix (`bluesky-3`), which the
    // column's CHECK constraint rejects.
    useSeeder: {
      count: 6,
      fixtures: [
        { provider: 'bluesky', displayName: 'Bluesky', status: 'active', characterLimit: 300 },
        { provider: 'twitter', displayName: 'Twitter/X', status: 'active', characterLimit: 280 },
        { provider: 'mastodon', displayName: 'Mastodon', status: 'active', characterLimit: 500 },
        { provider: 'linkedin', displayName: 'LinkedIn', status: 'active', characterLimit: 3000 },
        { provider: 'instagram', displayName: 'Instagram', status: 'active', characterLimit: 2200 },
        { provider: 'threads', displayName: 'Threads', status: 'active', characterLimit: 500 },
      ],
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
