import { describe, expect, test } from 'bun:test'
import { safeMarkdown } from '../../app/Support/Social/safe-markdown'

describe('post text made safe to publish', () => {
  test('a script tag, an event attribute and raw HTML render as text', () => {
    const out = safeMarkdown('Hello <script>alert(1)</script> and <img src=x onerror=alert(2)>')
    expect(out).toBe('Hello &lt;script&gt;alert(1)&lt;/script&gt; and &lt;img src=x onerror=alert(2)&gt;')
    expect(out).not.toContain('<')
  })

  test('an unsafe link target is dropped, a normal one kept', () => {
    expect(safeMarkdown('[x](javascript:alert(3))')).toBe('[x](#)')
    expect(safeMarkdown('![p](data:text/html;base64,AAA)')).toBe('![p](#)')
    expect(safeMarkdown('[site](https://example.com/a?b=1)')).toBe('[site](https://example.com/a?b=1)')
    expect(safeMarkdown('[mail](mailto:me@example.com) [up](../about) [top](#intro)')).toBe('[mail](mailto:me@example.com) [up](../about) [top](#intro)')
  })

  test('code is left exactly as written', () => {
    const fenced = 'Before <b>\n\n```html\n<div class="x">&amp;</div>\n```\n\nAfter'
    expect(safeMarkdown(fenced)).toBe('Before &lt;b&gt;\n\n```html\n<div class="x">&amp;</div>\n```\n\nAfter')
    expect(safeMarkdown('Use `a < b` here, not <b>')).toBe('Use `a < b` here, not &lt;b&gt;')
  })

  test('Markdown itself still works: quotes, emphasis, entities', () => {
    expect(safeMarkdown('> a quote\n\n**bold** & _it_ &amp; 1 > 0')).toBe('> a quote\n\n**bold** &amp; _it_ &amp; 1 &gt; 0')
  })
})
