/**
 * One upgrade for tests/unit/desktop-upgrade.test.ts, in a process of its
 * own: prepareData changes the working directory and the environment, which
 * must not happen to the test runner.
 *
 *   bun tests/support/desktop-upgrade-run.ts <dataDir> <migrated-db-with-ledger>
 */
import { Database } from 'bun:sqlite'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { prepareData } from '../../app/Desktop/data'
import { testKeychain } from './workspace-keychain'

const [dataDir, ledgerDb] = process.argv.slice(2)
const root = join(import.meta.dir, '../..')
// The migrations the Mac app carries are the ones `buddy migrate` applies
// here, which the suite's own migrated database records.
const ledger = new Database(ledgerDb!)
const names = (ledger.query('SELECT migration FROM migrations ORDER BY id').all() as Array<{ migration: string }>).map(row => row.migration)
ledger.close()
const migrations = Object.fromEntries(names.map(name => [name, readFileSync(join(root, 'database/migrations', name), 'utf8')]))

const legacyKey = `base64:${Buffer.alloc(32, 9).toString('base64')}`
writeFileSync(join(dataDir!, 'app.key'), legacyKey, { mode: 0o600 })
const prepared = await prepareData({ dataDir: dataDir!, template: join(dataDir!, 'unused.sqlite'), migrations, keychain: testKeychain() })
if (process.env.APP_KEY !== legacyKey) throw new Error('The workspace key changed during upgrade.')
console.log(JSON.stringify({ applied: prepared.applied, created: prepared.created }))
