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
    publishedAt: {
      required: false,
      fillable: true,
      validation: { rule: schema.timestamp().optional() },
      factory: faker => faker.date.recent({ days: 30 }).toISOString().slice(0, 19).replace('T', ' '),
    },
  },
} as const)
