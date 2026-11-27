import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/** Durable memory of an entry, even after the owner deletes its draft. */
export default defineModel({
  name: 'DraftFeedEntry',
  table: 'draft_feed_entries',
  primaryKey: 'id',
  autoIncrement: true,
  belongsTo: ['DraftFeed'],
  indexes: [{ name: 'draft_feed_entries_feed_key_unique', columns: ['draft_feed_id', 'entry_key'], unique: true }],
  attributes: {
    entryKey: { required: true, validation: { rule: schema.string().required().length(64) } },
  },
} as const)
