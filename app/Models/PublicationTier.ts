import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * A paid tier readers can subscribe to.
 *
 * The Stripe product and price are created once, when the tier is saved, and
 * their ids stored here. Prices are immutable in Stripe, so changing the
 * amount mints a new price and repoints the tier at it: existing subscribers
 * keep paying the price they signed up on, which is both what Stripe enforces
 * and what a reader would expect.
 *
 * Amounts are integer minor units. A float here would be a rounding bug
 * waiting for the first currency that does not divide cleanly.
 */
export default defineModel({
  name: 'PublicationTier',
  table: 'publication_tiers',
  primaryKey: 'id',
  autoIncrement: true,

  indexes: [
    { name: 'publication_tiers_active_sort_order_index', columns: ['active', 'sort_order'] },
  ],

  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: {
      uri: 'publication-tiers',
      routes: ['index', 'show'],
    },
  },

  belongsTo: ['Publication'],
  hasMany: ['PublicationSubscriber'],

  attributes: {
    name: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().min(2).max(80) },
      factory: faker => faker.helpers.arrayElement(['Monthly', 'Annual', 'Founding member']),
    },
    description: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(500).optional() },
      factory: faker => faker.lorem.sentence(),
    },
    /** Minor units, so 700 is $7.00. */
    amountCents: {
      required: true,
      fillable: true,
      validation: { rule: schema.number().min(0).required() },
      factory: faker => faker.helpers.arrayElement([500, 700, 1000, 5000]),
    },
    currency: {
      required: true,
      fillable: true,
      default: 'usd',
      validation: { rule: schema.string().required().min(3).max(3) },
      factory: () => 'usd',
    },
    interval: {
      required: true,
      fillable: true,
      default: 'month',
      validation: { rule: schema.enum(['month', 'year']).required() },
      factory: faker => faker.helpers.arrayElement(['month', 'year']),
    },
    stripeProductId: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(255).optional() },
      factory: () => null,
    },
    stripePriceId: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(255).optional() },
      factory: () => null,
    },
    active: {
      required: false,
      fillable: true,
      default: true,
      validation: { rule: schema.boolean() },
      factory: () => true,
    },
    sortOrder: {
      required: true,
      fillable: true,
      default: 0,
      validation: { rule: schema.number().min(0).required() },
      factory: () => 0,
    },
  },
} as const)
