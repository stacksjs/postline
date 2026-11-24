import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * The owner's own developer app on a network that signs in with OAuth (X,
 * LinkedIn, Instagram, Threads): its client id and secret. Postline brings
 * no keys of its own; each owner registers an app and enters it here, which
 * is what lets the Mac app, which reads no `.env`, connect these networks.
 * The secret is sealed with the app key, like the account tokens.
 */
export default defineModel({
  name: 'NetworkApp',
  table: 'network_apps',
  primaryKey: 'id',
  autoIncrement: true,

  indexes: [
    { name: 'network_apps_provider_unique', columns: ['provider'], unique: true },
  ],

  traits: {
    useTimestamps: true,
  },

  attributes: {
    provider: {
      required: true,
      fillable: true,
      validation: { rule: schema.enum(['twitter', 'linkedin', 'instagram', 'threads']).required() },
      factory: () => 'linkedin',
    },
    clientId: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().max(255) },
      factory: () => 'client-id',
    },
    clientSecret: {
      required: false,
      hidden: true,
      fillable: true,
      validation: { rule: schema.string().max(4000).optional() },
      factory: () => null,
    },
    redirectUrl: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(500).optional() },
      factory: () => null,
    },
  },
} as const)
