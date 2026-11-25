/**
 * Build the pages the desktop app carries.
 *
 * `buddy build:desktop` runs this in place of its own view build, and reads
 * the result from `DESKTOP_VIEWS_OUT`. The only difference from the default
 * is that the marketing pages are left out.
 *
 * They do not belong in the app, and they broke it: the static build writes
 * every page by its file name, so `features/analytics.stx` and
 * `analytics.stx` both became `analytics.html`, and the Analytics tab in the
 * app opened the marketing page about analytics.
 */
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { buildStaticSite } from '@stacksjs/stx'
import { marketingPaths } from '../Support/Marketing/site'

const outDir = process.env.DESKTOP_VIEWS_OUT
if (!outDir)
  throw new Error('DESKTOP_VIEWS_OUT is not set: this script is run by `buddy build:desktop`.')

await buildStaticSite({
  name: 'Postline',
  url: 'http://127.0.0.1',
  pagesDir: 'resources/views',
  excludeDirs: ['features', 'use-cases'],
  outDir,
  publicDir: 'resources/views/public',
  sitemap: false,
  robots: false,
})

// The marketing pages outside those two folders (the landing page, privacy,
// what leaves your machine, trademarks) are built like any other page, since
// the builder only skips whole folders. Remove their output: the app carries
// no page from the public site (#222). Both output shapes are covered, as the
// builder writes a page by its name.
for (const path of marketingPaths()) {
  const name = path === '/' ? 'index' : path.slice(1)
  if (name.includes('/')) continue
  for (const file of [`${name}.html`, join(name, 'index.html')])
    rmSync(join(outDir, file), { force: true })
}
