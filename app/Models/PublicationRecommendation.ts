import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * One publication vouching for another.
 *
 * This is the whole ranking input that cannot be bought: position in Discover
 * comes from who recommends you and how many people read them, so a
 * recommendation is a directed edge rather than a placement.
 *
 * The target is stored by slug as well as by id because a recommendation can
 * point at a publication that has not joined the network yet. Resolving it
 * later is a matter of filling in `publication_id`, not of losing the edge.
 */
export default defineModel({
  name: 'PublicationRecommendation',
  table: 'publication_recommendations',
  primaryKey: 'id',
  autoIncrement: true,

  indexes: [
    { name: 'publication_recommendations_edge_unique', columns: ['publication_id', 'target_slug'], unique: true },
  ],

  traits: {
    useUuid: true,
    useTimestamps: true,
    useApi: {
      uri: 'publication-recommendations',
      routes: ['index', 'show'],
      middleware: ['auth'],
    },
  },

  belongsTo: ['Publication'],

  attributes: {
    targetSlug: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().max(140) },
      factory: faker => faker.lorem.slug(),
    },
    targetName: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().max(120) },
      factory: faker => `${faker.word.adjective()} ${faker.word.noun()}`,
    },
    /** Why the recommending writer reads it. Shown verbatim in Discover. */
    note: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(500).optional() },
      factory: faker => faker.lorem.sentence(),
    },
    /** Set once the target publication exists on this instance. */
    targetPublicationId: {
      required: false,
      fillable: true,
      validation: { rule: schema.number().min(1).optional() },
      factory: () => null,
    },
  },
} as const)
