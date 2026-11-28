import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * The owner's own developer app on a network that signs in with OAuth (X,
 * LinkedIn, Instagram, Threads): its client id and optional secret. Postline brings
 * no keys of its own; each owner registers an app and enters it here, which
 * is what lets the Mac app, which reads no `.env`, connect these networks.
 * The secret is sealed with the app key, like the account tokens. A public X
 * app stores no client secret.
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
    /**
     * LinkedIn only: also connect the company Pages the owner administers.
     * Off unless asked for, because the scopes it requests need LinkedIn's
     * Community Management API product, and asking for a scope the app does
     * not have fails the whole sign-in.
     */
    organizationPages: {
      required: false,
      fillable: true,
      default: false,
      validation: { rule: schema.boolean() },
      factory: () => false,
    },
    /** Optional read scopes for the app's engagement analytics. */
    engagementMetrics: {
      required: false,
      fillable: true,
      default: false,
      validation: { rule: schema.boolean() },
      factory: () => false,
    },
    /** X only. Request Inbox scopes and enable user-initiated paid calls. */
    directMessages: {
      required: false,
      fillable: true,
      default: false,
      validation: { rule: schema.boolean() },
      factory: () => false,
    },
    /** Instagram only. Request permission to add first comments. */
    firstComments: {
      required: false,
      fillable: true,
      default: false,
      validation: { rule: schema.boolean() },
      factory: () => false,
    },
  },
} as const)
