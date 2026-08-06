import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * A publication on the Open Times network.
 *
 * One per account today, but modelled as its own table rather than as columns
 * on `accounts` because Discover ranks, lists and recommends publications, and
 * all three of those want a row with a slug they can key on.
 *
 * `listed` is the opt-in. A publication is invisible to Discover until its
 * owner turns this on, which is why it defaults to false while the short-form
 * publish target defaults to on: sharing an individual post is a smaller
 * decision than putting your whole publication in an index.
 */
export default defineModel({
  name: 'Publication',
  table: 'publications',
  primaryKey: 'id',
  autoIncrement: true,

  indexes: [
    { name: 'publications_slug_unique', columns: ['slug'], unique: true },
    { name: 'publications_listed_subscriber_count_index', columns: ['listed', 'subscriber_count'] },
  ],

  traits: {
    useUuid: true,
    useTimestamps: true,
    useSearch: {
      displayable: ['name', 'tagline', 'slug'],
      searchable: ['name', 'tagline', 'description'],
      sortable: ['subscriber_count', 'created_at'],
      filterable: ['listed'],
    },
    useApi: {
      uri: 'publications',
      routes: ['index', 'show'],
    },
  },

  belongsTo: ['Account'],
  hasMany: ['DiscoverEntry', 'PublicationRecommendation'],

  attributes: {
    name: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().min(2).max(120) },
      factory: faker => `${faker.word.adjective()} ${faker.word.noun()}`,
    },
    slug: {
      required: true,
      fillable: true,
      unique: true,
      validation: { rule: schema.string().required().max(140) },
      factory: faker => faker.lorem.slug(),
    },
    tagline: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(200).optional() },
      factory: faker => faker.company.catchPhrase(),
    },
    description: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(2000).optional() },
      factory: faker => faker.lorem.paragraph(),
    },
    /** The publication's own domain. Absent until one is configured. */
    domain: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(255).optional() },
      factory: () => null,
    },
    avatarUrl: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(1000).optional() },
      factory: () => null,
    },
    authorName: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(120).optional() },
      factory: faker => faker.person.fullName(),
    },
    /** Opt-in to the Discover index. Unlisted until explicitly turned on. */
    listed: {
      required: false,
      fillable: true,
      default: false,
      validation: { rule: schema.boolean() },
      factory: () => false,
    },
    /**
     * Denormalized counters. Discover ranks by subscribers, and recomputing
     * that across every publication on each feed read would make the ranking
     * cost grow with the network rather than with the page size.
     */
    subscriberCount: {
      required: true,
      fillable: true,
      default: 0,
      validation: { rule: schema.number().min(0).required() },
      factory: faker => faker.number.int({ min: 0, max: 5000 }),
    },
    entryCount: {
      required: true,
      fillable: true,
      default: 0,
      validation: { rule: schema.number().min(0).required() },
      factory: () => 0,
    },
    lastPublishedAt: {
      required: false,
      fillable: true,
      validation: { rule: schema.timestamp().optional() },
      factory: () => null,
    },
  },
} as const)
