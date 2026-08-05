import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * A reader's comment on a published post.
 *
 * Named `PostComment` rather than `Comment` because the framework already
 * ships a `Comment` model for its own CMS, and two models competing for one
 * table name is a debugging session nobody enjoys.
 *
 * Threading is a self-referential `parent_id` rather than a materialised path.
 * A publication's comment thread is tens of rows, not millions, so the tree is
 * assembled in memory and the schema stays something you can read.
 *
 * Commenters are identified by their subscriber row when they have one, and by
 * a name and email otherwise. There is no separate comment login, because
 * asking a reader to create a second account to reply is how comment sections
 * die.
 */
export default defineModel({
  name: 'PostComment',
  table: 'post_comments',
  primaryKey: 'id',
  autoIncrement: true,

  indexes: [
    { name: 'post_comments_target_status_index', columns: ['source_key', 'status', 'created_at'] },
    { name: 'post_comments_parent_index', columns: ['parent_id'] },
  ],

  traits: {
    useUuid: true,
    useTimestamps: true,
    useSearch: {
      displayable: ['author_name', 'body', 'status'],
      searchable: ['author_name', 'body'],
      sortable: ['created_at'],
      filterable: ['status'],
    },
    useApi: {
      uri: 'post-comments',
      routes: ['index', 'show'],
    },
  },

  belongsTo: ['Publication', 'PublicationSubscriber'],

  attributes: {
    /** Which post this is on. Matches the Discover entry's source key. */
    sourceKey: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().max(255) },
      factory: faker => `blog:${faker.lorem.slug()}`,
    },
    /** Self-referential thread parent. Null for a top-level comment. */
    parentId: {
      required: false,
      fillable: true,
      validation: { rule: schema.number().min(1).optional() },
      factory: () => null,
    },
    authorName: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().min(1).max(120) },
      factory: faker => faker.person.fullName(),
    },
    authorEmail: {
      required: true,
      hidden: true,
      fillable: true,
      validation: { rule: schema.string().required().email().max(255) },
      factory: faker => faker.internet.email().toLowerCase(),
    },
    body: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().min(1).max(5000) },
      factory: faker => faker.lorem.paragraph(),
    },
    /**
     * `pending` exists so a publication can hold first-time commenters for
     * review without losing them. `spam` is kept rather than deleted, so a
     * false positive can be recovered.
     */
    status: {
      required: true,
      fillable: true,
      default: 'visible',
      validation: { rule: schema.enum(['visible', 'pending', 'spam', 'removed']).required() },
      factory: () => 'visible',
    },
  },
} as const)
