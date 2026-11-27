/**
 * Build the pages the desktop app carries.
 *
 * `buddy build:desktop` runs this in place of its own view build, and reads
 * the result from `DESKTOP_VIEWS_OUT`. Use the production renderer so the
 * bundled pages carry their layout head, including the CSRF fetch bootstrap.
 */
import { rmSync } from 'node:fs'
import process from 'node:process'
import { generateStaticSite } from '@stacksjs/stx/ssg'
import { marketingPaths } from '../Support/Marketing/site'

const outDir = process.env.DESKTOP_VIEWS_OUT
if (!outDir)
  throw new Error('DESKTOP_VIEWS_OUT is not set: this script is run by `buddy build:desktop`.')

const build = await generateStaticSite({
  domain: 'http://127.0.0.1',
  pagesDir: 'resources/views',
  outputDir: outDir,
  publicDir: 'resources/views/public',
  sitemap: false,
  robots: false,
  generate404: false,
  cache: false,
})
if (build.failedCount) throw new Error(`Could not build ${build.failedCount} desktop view(s).`)

// The production renderer preserves route directories. Remove the public
// site by route so its Analytics article cannot replace the workspace page.
const marketing = new Set(marketingPaths())
for (const page of build.pages) {
  if (marketing.has(page.route)) rmSync(page.outputPath)
}
