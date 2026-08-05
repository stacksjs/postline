import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/** One direct-message thread on a connected network. */
export default defineModel({
  name: 'DmConversation',
  table: 'dm_conversations',
  primaryKey: 'id',
  autoIncrement: true,

  indexes: [
    { name: 'dm_conversations_provider_remote_id_unique', columns: ['provider', 'remote_id'], unique: true },
    { name: 'dm_conversations_status_last_message_at_index', columns: ['status', 'last_message_at'] },
  ],

  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: {
      uri: 'dm-conversations',
      routes: ['index', 'show'],
      middleware: ['auth'],
    },
  },

  belongsTo: ['SocialIdentity'],
  hasMany: ['DmMessage'],

  attributes: {
    provider: {
      required: true,
      fillable: true,
      validation: { rule: schema.enum(['bluesky', 'twitter', 'mastodon']).required() },
      factory: () => 'bluesky',
    },
    remoteId: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().max(255) },
      factory: faker => faker.string.alphanumeric(24),
    },
    participantHandle: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().max(200) },
      factory: faker => `${faker.string.alphanumeric(8)}.bsky.social`,
    },
    participantName: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(200).optional() },
      factory: faker => faker.person.fullName(),
    },
    participantAvatar: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(1000).optional() },
      factory: () => null,
    },
    participantRemoteId: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(255).optional() },
      factory: faker => `did:plc:${faker.string.alphanumeric(24).toLowerCase()}`,
    },
    lastMessageAt: {
      required: false,
      fillable: true,
      validation: { rule: schema.timestamp().optional() },
      factory: () => new Date().toISOString().slice(0, 19).replace('T', ' '),
    },
    lastMessagePreview: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(500).optional() },
      factory: faker => faker.lorem.sentence(),
    },
    /**
     * Whether the newest message is ours. Denormalized onto the conversation so
     * the inbox list can show "You: …" without loading every thread's messages.
     */
    lastMessageOutgoing: {
      required: false,
      fillable: true,
      default: false,
      validation: { rule: schema.boolean() },
      factory: () => false,
    },
    unreadCount: {
      required: true,
      fillable: true,
      default: 0,
      validation: { rule: schema.number().min(0).required() },
      factory: () => 0,
    },
    status: {
      required: true,
      fillable: true,
      default: 'open',
      validation: { rule: schema.enum(['open', 'archived']).required() },
      factory: () => 'open',
    },
  },
} as const)
