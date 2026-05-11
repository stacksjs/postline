import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'MediaAsset',
  table: 'media_assets',
  primaryKey: 'id',
  autoIncrement: true,

  traits: {
    useUuid: true,
    useTimestamps: true,
    useSeeder: { count: 8 },
    useApi: {
      uri: 'media-assets',
      routes: ['index', 'store', 'show', 'update', 'destroy'],
    },
  },

  belongsTo: ['Post'],

  attributes: {
    type: {
      required: true,
      fillable: true,
      default: 'image',
      validation: { rule: schema.enum(['image', 'video', 'link']).required() },
      factory: () => 'image',
    },
    url: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().url().required() },
      factory: faker => faker.image.urlPicsumPhotos(),
    },
    altText: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(1000).optional() },
      factory: faker => faker.lorem.sentence(),
    },
    mimeType: {
      required: false,
      fillable: true,
      validation: { rule: schema.string().max(120).optional() },
      factory: () => 'image/jpeg',
    },
    byteSize: {
      required: false,
      fillable: true,
      default: 0,
      validation: { rule: schema.number().min(0).optional() },
      factory: faker => faker.number.int({ min: 20000, max: 5000000 }),
    },
  },
} as const)
