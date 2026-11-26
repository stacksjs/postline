import { describe, expect, test } from 'bun:test'
import { parseCsv } from '../../app/Services/ImportService'

describe('csv parsing', () => {
  test('a plain export becomes rows keyed by header', () => {
    const rows = parseCsv('email,name\nreader@example.com,A Reader\nsecond@example.com,Second')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ email: 'reader@example.com', name: 'A Reader' })
  })

  test('quoted fields may contain commas', () => {
    const rows = parseCsv('email,name\nreader@example.com,"Reader, A"')
    expect(rows[0]!.name).toBe('Reader, A')
  })

  test('a doubled quote inside a quoted field is a literal quote', () => {
    const rows = parseCsv('email,name\nreader@example.com,"He said ""hi"""')
    expect(rows[0]!.name).toBe('He said "hi"')
  })

  test('quoted fields may contain newlines', () => {
    const rows = parseCsv('email,note\nreader@example.com,"line one\nline two"')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.note).toBe('line one\nline two')
  })

  test('headers are lowercased and values trimmed, so column case does not matter', () => {
    const rows = parseCsv('Email,Name\n  reader@example.com ,  A Reader ')
    expect(rows[0]).toEqual({ email: 'reader@example.com', name: 'A Reader' })
  })

  test('windows line endings parse the same as unix ones', () => {
    const rows = parseCsv('email,name\r\nreader@example.com,A Reader')
    expect(rows[0]!.name).toBe('A Reader')
  })

  test('blank lines are dropped rather than becoming empty rows', () => {
    expect(parseCsv('email\nreader@example.com\n\n\n')).toHaveLength(1)
  })

  test('an empty file, or one with only a header, yields no rows', () => {
    expect(parseCsv('')).toEqual([])
    expect(parseCsv('   ')).toEqual([])
    expect(parseCsv('email,name')).toEqual([])
  })

  test('a short row does not read undefined into later columns', () => {
    const rows = parseCsv('email,name,plan\nreader@example.com,A Reader')
    expect(rows[0]!.plan).toBe('')
  })
})

describe('importing posts (#117)', () => {
  test('slugs keep any script, and Latin accents drop to their letter', async () => {
    const { slugify } = await import('../../app/Services/Social/BlogService')
    expect(slugify('Café au lait')).toBe('cafe-au-lait')
    expect(slugify('東京の夏')).toBe('東京の夏')
    expect(slugify('Ελληνικά νέα')).toBe('ελληνικα-νεα')
    expect(slugify('ガイド')).toBe('ガイド')
    expect(slugify('!!!')).toBe('post')
  })

  test('mixed-script posts are written as files, a re-run updates, and bad rows are listed', async () => {
    const { existsSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { imports } = await import('../../app/Services/ImportService')
    const tag = crypto.randomUUID().slice(0, 6)
    const rows = [
      { title: `東京 ${tag}`, body: 'Japanese title', publishedAt: '2026-01-02' },
      { title: `Café ${tag}`, body: 'French title' },
      { title: `Weekly ${tag}`, body: 'first' },
      { title: `Weekly ${tag}`, body: 'second, same title' },
      { title: '', body: 'no title' },
      { title: `Dated ${tag}`, body: 'bad date', publishedAt: 'next tuesday-ish' },
    ]

    const report = await imports.importPosts(rows)
    expect(report.imported).toBe(4)
    expect(report.updated).toBe(0)
    expect(report.skipped).toBe(2)
    expect(report.skippedRows.map(item => item.row)).toEqual([5, 6])
    expect(report.skippedRows[1]!.reason).toContain('not a date')
    expect(existsSync(join(String(process.env.POSTLINE_BLOG_DIR), `東京-${tag}.md`))).toBe(true)
    expect(existsSync(join(String(process.env.POSTLINE_BLOG_DIR), `weekly-${tag}-2.md`))).toBe(true)

    const again = await imports.importPosts(rows.slice(0, 2))
    expect(again).toMatchObject({ imported: 0, updated: 2, skipped: 0 })
  })

  test('6,000 rows: the preview counts every row, and says which ones are past the cap', async () => {
    const { imports, MAX_ROWS } = await import('../../app/Services/ImportService')
    const scripts = ['Post', 'Пост', '投稿', 'منشور', 'Δημοσίευση']
    const rows = Array.from({ length: 6000 }, (_unused, index) => index % 1000 === 999
      ? { title: '', body: 'missing title' }
      : { title: `${scripts[index % scripts.length]} ${index} ${crypto.randomUUID().slice(0, 4)}`, body: `Body ${index}` })

    const report = await imports.importPosts(rows, { dryRun: true })
    expect(report.dryRun).toBe(true)
    expect(report.imported + report.updated + report.skipped).toBe(6000)
    // Five missing titles inside the cap, and every row past it.
    expect(report.skipped).toBe(5 + (6000 - MAX_ROWS))
    expect(report.skippedRows.filter(item => item.row > MAX_ROWS)).toHaveLength(6000 - MAX_ROWS)
    expect(report.imported).toBe(MAX_ROWS - 5)
  }, 60_000)
})
