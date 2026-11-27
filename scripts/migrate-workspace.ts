import process from 'node:process'
import { archiveRetiredPublications } from '../app/Support/Database/archive-retired-publications'
import config from '../config/database'

if (config.default === 'sqlite') {
  const archive = archiveRetiredPublications(config.connections.sqlite.database)
  if (archive)
    console.log(`Saved retired publication data to ${archive}`)
}

const migrate = Bun.spawn([process.execPath, 'node_modules/@stacksjs/buddy/dist/cli.js', 'migrate', '--no-generate'], {
  stdout: 'inherit',
  stderr: 'inherit',
})
process.exitCode = await migrate.exited
