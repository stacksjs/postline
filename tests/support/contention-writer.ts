/**
 * One writer for tests/unit/sqlite-contention.test.ts: a separate process
 * writing through the app's own database layer, as the API and the scheduler
 * do. Prints how many of its writes landed.
 */
import process from 'node:process'
import { db } from '@stacksjs/database'

const database = db as any
const tag = process.argv[2] || 'writer'
const count = Number(process.argv[3]) || 200
let landed = 0
for (let index = 0; index < count; index++) {
  const at = new Date().toISOString().slice(0, 19).replace('T', ' ')
  await database.insertInto('alerts').values({ kind: 'post-failed', title: `${tag} ${index}`, dedupe_key: `contention:${tag}:${index}`, created_at: at, updated_at: at }).execute()
  landed++
}
console.log(`landed ${landed}`)
process.exit(0)
