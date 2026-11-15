import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * One item in the Discover feed.
 *
 * Long-form and short-form share a table rather than getting one each. They
 * are ranked by the same signals, moderated by the same rules and rendered by
 * the same realtime path, so splitting them would duplicate all three to save
 * one column. `form` is the discriminator, and both feeds are an indexed read
 * against it.
 *
 * The `remote_uri` on a short entry is its `posts` row and on a long entry its
 * `blog_posts` slug, which is what makes a republish idempotent: the unique
 * index below is what stops a retried publish from posting twice.
 */
export default defineModel({
  name: 'DiscoverEntry',
  table: 'discover_entries',
  primaryKey: 'id',
  autoIncrement: true,

  indexes: [
    { name: 'discover_entries_form_published_at_index', columns: ['form', 'published_at'] },
    { name: 'discover_entries_publication_source_unique', columns: ['publication_id', 'form', 'source_key'], unique: true },
    { name: 'discover_entries_status_score_index', columns: ['status', 'score'] },
  ],

  traits: {
    useUuid: true,
    useTimestamps: true,
    useSearch: {
      displayable: ['title', 'body', 'form', 'published_at'],
      searchable: ['title', 'body'],
      sortable: ['published_at', 'score'],
      filterable: ['form', 'status'],
    },
    useApi: {
      uri: 'discover-entries',
      routes: ['index', 'show'],
    },
  },

  belongsTo: ['Publication', 'Post'],

  attributes: {
    /**
     * `short` is a composer post published to Postline as a network.
     * `long` is an essay published to a listed publication.
     */
    form: {
      required: true,
      fillable: true,
      validation: { rule: schema.enum(['short', 'long']).required() },
      factory: faker => faker.helpers.arrayElement(['short', 'long']),
    },
    /**
     * Stable per-publication identity for the thing this entry came from, so
     * republishing updates the entry instead of adding a second one.
     */
    sourceKey: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().max(255) },
      factory: faker => faker.string.alphanumeric(20),
    },
    title: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(300).optional() },
      factory: faker => faker.lorem.sentence({ min: 4, max: 10 }),
    },
    body: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().min(1).max(10000) },
      factory: faker => faker.lorem.paragraph(),
    },
    /** Where the entry links to. Relative for a local blog post. */
    url: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(1000).optional() },
      factory: () => null,
    },
    status: {
      required: true,
      fillable: true,
      default: 'visible',
      validation: { rule: schema.enum(['visible', 'hidden', 'removed']).required() },
      factory: () => 'visible',
    },
    publishedAt: {
      required: true,
      fillable: true,
      validation: { rule: schema.timestamp().required() },
      factory: () => new Date().toISOString().slice(0, 19).replace('T', ' '),
    },
    /**
     * Ranking signals. Stored rather than joined because the feed sorts on
     * them, and a sort that cannot use an index is a table scan per page view.
     */
    score: {
      required: true,
      fillable: true,
      default: 0,
      validation: { rule: schema.number().min(0).required() },
      factory: faker => faker.number.int({ min: 0, max: 400 }),
    },
    readCount: {
      required: true,
      fillable: true,
      default: 0,
      validation: { rule: schema.number().min(0).required() },
      factory: faker => faker.number.int({ min: 0, max: 900 }),
    },
    /**
     * Subscriptions attributed to this entry. The number the analytics page
     * calls "the post that won the subscriber", counted here so ranking can
     * favour writing that actually converts rather than writing that travels.
     */
    conversionCount: {
      required: true,
      fillable: true,
      default: 0,
      validation: { rule: schema.number().min(0).required() },
      factory: faker => faker.number.int({ min: 0, max: 25 }),
    },
  },
} as const)
