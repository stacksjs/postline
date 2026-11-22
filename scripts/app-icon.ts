/**
 * Draw the Postline icon as PNGs.
 *
 * The mark is three shapes (an ink tile, a pale stem and a signal dot, making
 * a P: a post on a line), so it is drawn here
 * and not exported from a design tool: the app icon, the touch icons and the
 * favicon cannot drift, and regenerating them needs nothing but Bun.
 *
 *   bun scripts/app-icon.ts
 *
 * Writes:
 *   resources/assets/images/app-icon.png   1024, transparent corners, inset
 *                                          tile. `buddy build:dmg` turns this
 *                                          into the bundle's .icns.
 *   public/images/postline-icon-{180,512}.png   full-bleed, for touch icons,
 *                                          which the OS masks itself.
 *
 * `app/Desktop/AppIcon.icns` (the Mac App Store build's icon) is made from the
 * first of those with `iconutil`; see docs/desktop.md.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { deflateSync } from 'node:zlib'

const root = join(import.meta.dir, '..')
const INK = [10, 10, 11]
const BRAND = [240, 68, 30]

/** Coverage of a rounded square at a point, in [0, 1]. */
function inTile(x: number, y: number, inset: number, size: number, radius: number): boolean {
  const min = inset
  const max = size - inset
  if (x < min || x > max || y < min || y > max) return false
  const cx = Math.min(Math.max(x, min + radius), max - radius)
  const cy = Math.min(Math.max(y, min + radius), max - radius)
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius
}

/**
 * The mark, on the 64-unit grid `public/favicon.svg` is drawn on: a pale stem
 * and the signal dot beside its top. Kept here as numbers so every size is
 * drawn from the same proportions as the SVG.
 */
const GRID = 64
const STEM = { x: 17.5, y: 15, width: 7, height: 34 }
const DOT = { cx: 36.25, cy: 25.5, r: 10.5 }
const PAPER = [250, 250, 250]

/** Whether a point on the 64 grid is inside the stem, a rectangle with round ends. */
function inStem(gx: number, gy: number): boolean {
  const r = STEM.width / 2
  const cx = STEM.x + r
  if (gx < STEM.x || gx > STEM.x + STEM.width || gy < STEM.y || gy > STEM.y + STEM.height) return false
  const cy = Math.min(Math.max(gy, STEM.y + r), STEM.y + STEM.height - r)
  return (gx - cx) ** 2 + (gy - cy) ** 2 <= r * r
}

function draw(size: number, options: { inset: number, radius: number }): Uint8Array {
  const pixels = new Uint8Array(size * size * 4)
  const samples = 4
  const scale = GRID / (size - options.inset * 2)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let tile = 0
      let dot = 0
      let stem = 0
      // Supersampled, so the curves are smooth at every size the OS scales to.
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const px = x + (sx + 0.5) / samples
          const py = y + (sy + 0.5) / samples
          if (inTile(px, py, options.inset, size, options.radius)) tile++
          const gx = (px - options.inset) * scale
          const gy = (py - options.inset) * scale
          if ((gx - DOT.cx) ** 2 + (gy - DOT.cy) ** 2 <= DOT.r * DOT.r) dot++
          else if (inStem(gx, gy)) stem++
        }
      }

      const total = samples * samples
      const dotShare = dot / total
      const stemShare = stem / total
      const inkShare = 1 - dotShare - stemShare
      const i = (y * size + x) * 4
      for (let channel = 0; channel < 3; channel++)
        pixels[i + channel] = Math.round(BRAND[channel]! * dotShare + PAPER[channel]! * stemShare + INK[channel]! * inkShare)
      pixels[i + 3] = Math.round(255 * tile / total)
    }
  }

  return pixels
}

function crc32(bytes: Uint8Array): number {
  let crc = ~0
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1))
  }
  return ~crc >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(new TextEncoder().encode(type), 4)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

function png(size: number, pixels: Uint8Array): Uint8Array {
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, size)
  view.setUint32(4, size)
  header.set([8, 6, 0, 0, 0], 8) // 8-bit RGBA

  // Each scanline is prefixed with its filter type; 0 is "none".
  const raw = new Uint8Array(size * (size * 4 + 1))
  for (let y = 0; y < size; y++)
    raw.set(pixels.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1)

  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

const outputs: Array<[string, number, { inset: number, radius: number }]> = [
  // macOS: the tile sits inside the canvas with transparent corners, on the
  // proportions of Apple's icon grid (824 of 1024, radius 186).
  ['resources/assets/images/app-icon.png', 1024, { inset: 100, radius: 186 }],
  // Touch icons: full bleed and square, because iOS and Android cut the shape.
  ['public/images/postline-icon-512.png', 512, { inset: 0, radius: 0 }],
  ['public/images/postline-icon-180.png', 180, { inset: 0, radius: 0 }],
]

for (const [file, size, options] of outputs) {
  writeFileSync(join(root, file), png(size, draw(size, options)))
  // eslint-disable-next-line no-console
  console.log(`Wrote ${file} (${size}x${size})`)
}

process.exit(0)
