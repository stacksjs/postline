import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * A reader of the publication.
 *
 * Deliberately not a `User`. Readers cannot sign in, own nothing in the app,
 * and exist in numbers that would make the users table a different shape
 * entirely. They are also the asset the product promises you own outright, so
 * they get their own table you can read, export and back up on its own.
 *
 * Paid readers carry Stripe ids rather than card data. The Open Times never sees a
 * card number: checkout happens on Stripe's page and the webhook tells us what
 * happened.
 *
 * `source_entry_id` is the Discover attribution. It is what lets the analytics
 * page say which post won a subscriber, and it feeds the conversion signal
 * Discover ranks on.
 */
export default defineModel({
  name: 'PublicationSubscriber',
  table: 'publication_subscribers',
  primaryKey: 'id',
  autoIncrement: true,

  indexes: [
    { name: 'publication_subscribers_email_unique', columns: ['publication_id', 'email'], unique: true },
    { name: 'publication_subscribers_status_plan_index', columns: ['status', 'plan'] },
    { name: 'publication_subscribers_unsubscribe_token_unique', columns: ['unsubscribe_token'], unique: true },
  ],

  traits: {
    useUuid: true,
    useTimestamps: true,
    useSearch: {
      displayable: ['email', 'name', 'plan', 'status'],
      searchable: ['email', 'name'],
      sortable: ['created_at', 'confirmed_at'],
      filterable: ['status', 'plan'],
    },
    useApi: {
      uri: 'publication-subscribers',
      routes: ['index', 'show'],
      middleware: ['auth'],
    },
  },

  belongsTo: ['Publication', 'PublicationTier'],

  attributes: {
    email: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().email().max(255) },
      factory: faker => faker.internet.email().toLowerCase(),
    },
    name: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(120).optional() },
      factory: faker => faker.person.fullName(),
    },
    /**
     * `pending` is an unconfirmed double opt-in. It never receives a post, so
     * a mistyped or maliciously-entered address cannot be mailed.
     */
    status: {
      required: true,
      fillable: true,
      default: 'pending',
      validation: { rule: schema.enum(['pending', 'active', 'unsubscribed', 'bounced']).required() },
      factory: () => 'active',
    },
    plan: {
      required: true,
      fillable: true,
      default: 'free',
      validation: { rule: schema.enum(['free', 'paid']).required() },
      factory: faker => faker.helpers.arrayElement(['free', 'free', 'paid']),
    },
    stripeCustomerId: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(255).optional() },
      factory: () => null,
    },
    stripeSubscriptionId: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(255).optional() },
      factory: () => null,
    },
    /** When the paid period ends. Access outlives a cancellation until this. */
    currentPeriodEnd: {
      required: false,
      fillable: true,
      validation: { rule: schema.timestamp().optional() },
      factory: () => null,
    },
    /** Set on cancellation, so a reader keeps access to the end of the period. */
    cancelsAt: {
      required: false,
      fillable: true,
      validation: { rule: schema.timestamp().optional() },
      factory: () => null,
    },
    confirmationToken: {
      required: false,
      hidden: true,
      fillable: true,
      validation: { rule: schema.string().max(120).optional() },
      factory: () => null,
    },
    /** One-click unsubscribe, so a mail footer needs no login. */
    unsubscribeToken: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().max(120) },
      factory: faker => faker.string.alphanumeric(32),
    },
    confirmedAt: {
      required: false,
      fillable: true,
      validation: { rule: schema.timestamp().optional() },
      factory: () => new Date().toISOString().slice(0, 19).replace('T', ' '),
    },
    source: {
      required: true,
      fillable: true,
      default: 'site',
      validation: { rule: schema.enum(['site', 'discover', 'import', 'api']).required() },
      factory: () => 'site',
    },
    /** The Discover entry that won this reader, when there was one. */
    sourceEntryId: {
      required: false,
      fillable: true,
      validation: { rule: schema.number().min(1).optional() },
      factory: () => null,
    },
  },
} as const)
