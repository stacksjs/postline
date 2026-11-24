/**
 * Make post text safe to publish as Markdown.
 *
 * The blog renderer turns a post's Markdown into HTML and passes any HTML in
 * it straight through, so a body containing `<script>`, an `onerror`
 * attribute or a `javascript:` link would run in every reader's browser.
 * Postline's posts are plain text and Markdown, never HTML, so angle brackets
 * outside code are written as text, and a link may only go somewhere a link
 * should: http, https, mailto, a relative path or an anchor.
 *
 * Code is left exactly as written: in a fenced block or between backticks,
 * Markdown already shows `<` as text, and escaping it there would show
 * `&lt;` instead.
 */

const SAFE_LINK = /^(?:https?:|mailto:|\/|#|\.{0,2}\/)/i

function escapeText(text: string): string {
  return text
    .replace(/&(?![a-z][a-z0-9]*;|#\d+;|#x[0-9a-f]+;)/gi, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, (match, offset: number, all: string) => {
      // A `>` that opens a line is a Markdown quote, not HTML.
      const lineStart = all.lastIndexOf('\n', offset - 1) + 1
      return /^\s*$/.test(all.slice(lineStart, offset)) ? match : '&gt;'
    })
    // [label](target) and ![alt](target): keep the label, drop an unsafe target.
    // A target may hold one level of parentheses, as `javascript:alert(1)` does.
    .replace(/(!?\[[^\]]*\])\(\s*<?((?:[^()\s>]|\([^()\s]*\))*)>?(\s+"[^"]*")?\s*\)/g, (match, label: string, target: string, title = '') =>
      SAFE_LINK.test(target) || /^[\w.-]+\.[a-z]{2,}(?:\/|$)/i.test(target) ? match : `${label}(#${title})`)
    // <https://…> autolinks were escaped above; let a plain address stand as text.
}

/** Escape HTML and unsafe links in `markdown`, leaving code untouched. */
export function safeMarkdown(markdown: string): string {
  const parts = String(markdown ?? '').split(/(^```[\s\S]*?^```[^\n]*$|^~~~[\s\S]*?^~~~[^\n]*$)/m)
  return parts.map((part, index) => {
    if (index % 2 === 1) return part
    // Inline code spans keep their contents.
    return part.split(/(`+[^`\n]*`+)/).map((piece, inner) => inner % 2 === 1 ? piece : escapeText(piece)).join('')
  }).join('')
}
