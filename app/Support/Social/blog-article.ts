/** Separate the title and Markdown body the same way for previews and publication. */
export function blogArticle(text: string, title?: string): { title: string, body: string } {
  const explicitTitle = title?.trim()
  const lines = text.split('\n')
  const first = lines.findIndex(line => line.trim())
  return {
    title: (explicitTitle || lines[first]?.trim() || 'Untitled post').slice(0, 200),
    body: explicitTitle ? text.trim() : lines.slice(first + 1).join('\n').trim() || text.trim(),
  }
}
