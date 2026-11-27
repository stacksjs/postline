import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export default defineModel({
  name: 'ComposerPreset',
  table: 'composer_presets',
  primaryKey: 'id',
  autoIncrement: true,

  traits: {
    useUuid: true,
    useTimestamps: true,
  },

  belongsTo: ['Account'],

  attributes: {
    kind: {
      required: true,
      fillable: true,
      validation: { rule: schema.enum(['snippet', 'template', 'hashtags']).required() },
    },
    name: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().max(80) },
    },
    body: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().required().max(10000) },
    },
  },
} as const)
