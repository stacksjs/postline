import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Sentences the site used to say that were not true (#219). Each may come
 * back only when the code makes it true and app/Support/Marketing/CLAIMS.md
 * says where.
 */
const root = join(import.meta.dir, '../..')

function files(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name)
    return statSync(join(root, path)).isDirectory() ? files(path) : path.endsWith('.stx') ? [path] : []
  })
}

const sources = [...files('resources/views'), ...files('resources/components/Marketing'), 'app/Support/Marketing/catalog.ts', 'README.md']
const text = sources.map(path => [path, readFileSync(join(root, path), 'utf8')] as const)

const retired: Array<[RegExp, string]> = [
  [/retried behind your back/i, 'failures are retried automatically (retry.ts)'],
  [/Bluesky, X, Mastodon,? and Instagram/, 'X direct messages are not supported'],
  [/Mastodon, Instagram and Bluesky|One list, every network/, 'Instagram messages need Meta app review (#129)'],
  [/per-network engagement|replies per network|stored per network/i, 'only Bluesky engagement is synced'],
  [/app passwords are encrypted/i, 'app passwords in .env stay plain text'],
  [/back up and export/i, 'there is no export'],
  [/revoke the tokens/i, 'disconnect does not revoke at the network'],
  [/per-seat|per seat/i, 'Postline has no seats'],
  [/one Bun process/i, 'a server install runs more than one process'],
  [/any machine that runs Bun/i, 'it also needs SQLite 3.47'],
  [/Sign in to each network once/i, 'four networks need a developer app first'],
  [/publish while you sleep/i, 'nothing publishes while the app is quit'],
]

describe('the site says only what is true', () => {
  for (const [pattern, why] of retired) {
    test(`no "${pattern.source}" (${why})`, () => {
      for (const [path, body] of text)
        expect(pattern.test(body), path).toBe(false)
    })
  }

  test('the hero labels the two destination previews shown in the screenshot', () => {
    const home = readFileSync(join(root, 'resources/views/index.stx'), 'utf8')
    expect(home).toContain('alt="Postline Composer showing one draft and live previews for Bluesky and LinkedIn"')
  })
})
