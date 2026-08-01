/**
 * Render one Open Graph card per marketing page with ts-images.
 *
 * The cards are generated rather than designed by hand so eleven pages cannot
 * drift apart, and so a new catalog entry gets a matching card for free. Type
 * is Geist, the same face the pages use, so a shared link looks like the site
 * it points at.
 *
 *   bun scripts/marketing-og.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { generateSocialCard, loadFont } from 'ts-images'
import { ALL_ENTRIES } from '../app/Support/Marketing/catalog'

const root = join(import.meta.dir, '..')
const outDir = join(root, 'public/images/og')
mkdirSync(outDir, { recursive: true })

const fontsDir = join(root, 'resources/assets/fonts/geist')
const titleFont = loadFont(new Uint8Array(readFileSync(join(fontsDir, 'Geist-600.ttf'))))
const bodyFont = loadFont(new Uint8Array(readFileSync(join(fontsDir, 'Geist-400.ttf'))))

// The marketing surface tokens from resources/layouts/marketing.stx, so the
// cards and the pages are the same palette rather than two near-misses.
const INK = { r: 10, g: 10, b: 10 }
const BODY = { r: 63, g: 63, b: 70 }
const ACCENT = { r: 16, g: 185, b: 129 }
const PAPER = { r: 244, g: 244, b: 242 }

/** The Postline mark: a rounded black square with a white P, drawn to match the nav. */
function drawMark(card: any, box: { x: number, y: number, size: number }): void {
  const { x, y, size } = box
  const data = card.data ?? card
  const width = card.width
  const radius = Math.round(size * 0.28)

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // Round the corners so the mark matches the nav's rounded-lg square.
      const cx = px < radius ? radius - px : px >= size - radius ? px - (size - radius - 1) : 0
      const cy = py < radius ? radius - py : py >= size - radius ? py - (size - radius - 1) : 0
      if (cx && cy && cx * cx + cy * cy > radius * radius)
        continue

      const i = ((y + py) * width + (x + px)) * 4
      data[i] = INK.r
      data[i + 1] = INK.g
      data[i + 2] = INK.b
      data[i + 3] = 255
    }
  }
}

/**
 * The card renders the subtitle on a single line, so a full summary is cut
 * mid-word. Trim at a word boundary instead, preferring the first clause.
 */
function fit(text: string, max = 58): string {
  if (text.length <= max)
    return text
  const clause = text.split(/,|\. /)[0] ?? text
  if (clause.length <= max)
    return clause
  return `${clause.slice(0, clause.lastIndexOf(' ', max)).trimEnd()}...`
}

interface Card {
  file: string
  eyebrow: string
  title: string
  subtitle: string
}

const cards: Card[] = [
  {
    file: 'home',
    eyebrow: 'Self-hosted',
    title: 'Post once. Everywhere.',
    subtitle: fit('One composer for Bluesky, X, LinkedIn and Mastodon.'),
  },
  {
    file: 'feature-index',
    eyebrow: 'Features',
    title: 'Everything Postline does',
    subtitle: fit('Crossposting, scheduling, variants, analytics, bulk delete.'),
  },
  {
    file: 'use-case-index',
    eyebrow: 'Use cases',
    title: 'Who runs Postline',
    subtitle: fit('Founders, advocates, maintainers, agencies and writers.'),
  },
  ...ALL_ENTRIES.map(entry => ({
    file: `${entry.kind}-${entry.slug}`,
    eyebrow: entry.kind === 'feature' ? 'Feature' : 'Use case',
    title: entry.title,
    subtitle: fit(entry.summary),
  })),
]

let built = 0
for (const card of cards) {
  const outputPath = join(outDir, `${card.file}.png`)
  await generateSocialCard(outputPath, {
    // Flat paper rather than a photograph: the site is light-locked, and a
    // stock image behind the type would fight the brand it is representing.
    backgroundColor: PAPER,
    brand: 'Postline',
    eyebrow: card.eyebrow,
    title: card.title,
    subtitle: card.subtitle,
    titleFont,
    bodyFont,
    color: INK,
    accent: ACCENT,
    mutedColor: BODY,
    markPlate: PAPER,
    drawMark,
    titleSize: 74,
    titleLines: 2,
    format: 'png',
  })
  built++
}

// eslint-disable-next-line no-console
console.log(`Rendered ${built} OG cards into public/images/og/`)
process.exit(0)
