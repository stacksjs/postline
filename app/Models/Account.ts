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
  },

  hasMany: ['SocialIdentity', 'Post', 'BlogPost', 'LaunchCampaign', 'PurgeRun', 'KeywordMonitor'],

  attributes: {
    name: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().min(2).max(120) },
      factory: () => 'Workspace owner',
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
    // Whether images for Instagram and Threads may be shared through a
    // short-lived public link when Postline has no public address of its own
    // (see app/Support/Social/media-share.ts). Off by default: the link is
    // relayed through a third-party server.
    shareMediaByTunnel: {
      required: false,
      fillable: true,
      default: false,
      validation: { rule: schema.boolean().optional() },
      factory: () => false,
    },
    defaultAudience: {
      required: true,
      fillable: true,
      default: 'public',
      validation: { rule: schema.enum(['public', 'followers', 'private']).required() },
      factory: () => 'public',
    },
    /**
     * Retention: delete this account's posts once they are older than
     * `autoDeleteDays`, every day, on the networks in `autoDeleteProviders`
     * (empty means every connected network that can delete). Off until the
     * owner turns it on in Settings; the daily AutoDeletePosts job reads it.
     */
    autoDeleteEnabled: {
      required: false,
      fillable: true,
      default: false,
      validation: { rule: schema.boolean() },
      factory: () => false,
    },
    autoDeleteDays: {
      required: false,
      fillable: true,
      default: 7,
      validation: { rule: schema.number().min(1).max(3650) },
      factory: () => 7,
    },
    autoDeleteProviders: {
      required: false,
      fillable: true,
      default: '[]',
      validation: { rule: schema.json() },
      factory: () => JSON.stringify([]),
    },
    /**
     * `tracked`: only posts published from here. `all`: everything on the
     * account. The narrowest is the default: widening it is a choice the
     * owner confirms (RetentionService `widensDeletion`).
     */
    autoDeleteScope: {
      required: false,
      fillable: true,
      default: 'tracked',
      validation: { rule: schema.enum(['tracked', 'all']) },
      factory: () => 'tracked',
    },
  },
} as const)
