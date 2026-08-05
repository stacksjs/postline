import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/** A single message inside a direct-message thread. */
export default defineModel({
  name: 'DmMessage',
  table: 'dm_messages',
  primaryKey: 'id',
  autoIncrement: true,

  indexes: [
    { name: 'dm_messages_conversation_remote_id_unique', columns: ['dm_conversation_id', 'remote_id'], unique: true },
    { name: 'dm_messages_conversation_sent_at_index', columns: ['dm_conversation_id', 'sent_at'] },
  ],

  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: {
      uri: 'dm-messages',
      routes: ['index', 'show'],
      middleware: ['auth'],
    },
  },

  belongsTo: ['DmConversation'],

  attributes: {
    provider: {
      required: true,
      fillable: true,
      validation: { rule: schema.enum(['bluesky', 'twitter', 'mastodon', 'instagram']).required() },
      factory: () => 'bluesky',
    },
    /**
     * Provider-side message id. Locally-sent messages that never reached the
     * network get a `pending:<uuid>` placeholder so the unique index still
     * holds and the row can be retried or cleaned up.
     */
    remoteId: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().max(255) },
      factory: faker => faker.string.alphanumeric(24),
    },
    direction: {
      required: true,
      fillable: true,
      validation: { rule: schema.enum(['incoming', 'outgoing']).required() },
      factory: () => 'incoming',
    },
    authorHandle: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().max(200) },
      factory: faker => `${faker.string.alphanumeric(8)}.bsky.social`,
    },
    authorName: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(200).optional() },
      factory: faker => faker.person.fullName(),
    },
    body: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().max(10000) },
      factory: faker => faker.lorem.sentences(2),
    },
    status: {
      required: true,
      fillable: true,
      default: 'received',
      validation: { rule: schema.enum(['received', 'sent', 'failed']).required() },
      factory: () => 'received',
    },
    failureReason: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(2000).optional() },
      factory: () => null,
    },
    sentAt: {
      required: true,
      fillable: true,
      validation: { rule: schema.timestamp().required() },
      factory: () => new Date().toISOString().slice(0, 19).replace('T', ' '),
    },
  },
} as const)
