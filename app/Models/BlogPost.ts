import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'BlogPost',
  table: 'blog_posts',
  primaryKey: 'id',
  autoIncrement: true,

  indexes: [
    { name: 'blog_posts_status_published_at_index', columns: ['status', 'published_at'] },
  ],

  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: {
      uri: 'blog-posts',
      routes: ['index', 'show'],
    },
  },

  belongsTo: ['Post', 'Account'],

  attributes: {
    title: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().max(200) },
      factory: faker => faker.lorem.sentence({ min: 3, max: 8 }),
    },
    slug: {
      required: true,
      fillable: true,
      unique: true,
      validation: { rule: schema.string().required().max(220) },
      factory: faker => faker.lorem.slug(),
    },
    body: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().min(1) },
      factory: faker => faker.lorem.paragraphs({ min: 2, max: 5 }),
    },
    excerpt: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(500).optional() },
      factory: faker => faker.lorem.sentences(2),
    },
    status: {
      required: true,
      fillable: true,
      default: 'draft',
      validation: { rule: schema.enum(['draft', 'published', 'archived']).required() },
      factory: () => 'published',
    },
    /**
     * Who can read the whole thing.
     *
     * `paid` shows everyone the opening and asks the rest to subscribe, which
     * is the per-post decision the pricing page promises rather than a plan
     * committed to up front. Separate from `status`: a published post and a
     * paywalled one are different questions.
     */
    access: {
      required: true,
      fillable: true,
      default: 'free',
      validation: { rule: schema.enum(['free', 'paid']).required() },
      factory: () => 'free',
    },
    /**
     * How much of a paywalled post is shown before the prompt.
     *
     * Stored per post because the right cut is editorial: some pieces give
     * away two paragraphs, some give away one line.
     */
    previewChars: {
      required: true,
      fillable: true,
      default: 600,
      validation: { rule: schema.number().min(0).required() },
      factory: () => 600,
    },
    publishedAt: {
      required: false,
      fillable: true,
      validation: { rule: schema.timestamp().optional() },
      factory: faker => faker.date.recent({ days: 30 }).toISOString().slice(0, 19).replace('T', ' '),
    },
  },
} as const)
