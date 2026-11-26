/**
 * Search and sharing details for the public site (#224): every page has a
 * title, description, card and card alt text of its own, and feature titles
 * name the feature.
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FEATURES } from '../../app/Support/Marketing/catalog'

const root = join(import.meta.dir, '../..')
const pages = [
  'resources/views/index.stx',
  ...['features', 'use-cases'].flatMap(dir => readdirSync(join(root, 'resources/views', dir)).filter(name => name.endsWith('.stx')).map(name => `resources/views/${dir}/${name}`)),
]

function section(source: string, name: string): string | undefined {
  return source.match(new RegExp(`@section\\('${name}', '((?:[^'\\\\]|\\\\.)*)'\\)`))?.[1]
}

const meta = pages.map((page) => {
  const source = readFileSync(join(root, page), 'utf8')
  const ogImage = source.match(/marketingHead\('[^']+', '([^']+)'\)/)?.[1]
  return { page, title: section(source, 'title'), description: section(source, 'description'), ogImage, ogImageAlt: section(source, 'ogImageAlt') }
})

describe('marketing page details', () => {
  for (const key of ['title', 'description', 'ogImage'] as const) {
    test(`each page has its own ${key}`, () => {
      const values = meta.map(entry => entry[key])
      expect(values.filter(value => !value)).toEqual([])
      expect(new Set(values).size).toBe(values.length)
    })
  }

  test('each feature and use-case page describes its own card', () => {
    const generated = meta.filter(entry => entry.page !== 'resources/views/index.stx')
    expect(generated.filter(entry => !entry.ogImageAlt).map(entry => entry.page)).toEqual([])
    expect(new Set(generated.map(entry => entry.ogImageAlt)).size).toBe(generated.length)
  })

  test('a feature title names the feature', () => {
    for (const feature of FEATURES) {
      const page = meta.find(entry => entry.page === `resources/views/features/${feature.slug}.stx`)
      expect(page?.title?.startsWith(`${feature.nav}: `)).toBe(true)
    }
  })

  test('the home page carries SoftwareApplication and FAQPage data', () => {
    const home = readFileSync(join(root, 'resources/views/index.stx'), 'utf8')
    expect(home).toContain("type: 'application/ld+json', content: jsonLd")
    expect(home).toContain('\'@type\': \'SoftwareApplication\'')
    expect(home).toContain('\'@type\': \'FAQPage\'')
  })
})
