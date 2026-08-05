/**
 * Text helpers shared by the parts of Postline that read posts back out of a
 * network rather than writing them into one.
 */

/**
 * Flatten a Mastodon-style HTML body to plain text.
 *
 * Mastodon returns `content` as HTML — paragraphs, `<br>`, and anchor tags for
 * mentions and links — but listening and the DM inbox both render into plain
 * text nodes, so the markup has to come off before storage rather than at each
 * render site.
 */
export function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, '\'')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .trim()
}
