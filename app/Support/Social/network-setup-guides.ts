import type { Tokens } from 'marked'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { marked } from 'marked'

const guideSlugs = {
  bluesky: 'bluesky',
  mastodon: 'mastodon',
  twitter: 'x',
  linkedin: 'linkedin',
  instagram: 'instagram',
  threads: 'threads',
}

export async function loadNetworkSetupGuides(locale = 'en') {
  const language = locale === 'es' ? 'es' : 'en'
  const directory = language === 'es' ? 'docs/es/networks' : 'docs/networks'
  return Object.fromEntries(await Promise.all(Object.entries(guideSlugs).map(async ([provider, slug]) => {
    const path = `${directory}/${slug}.md`
    const markdown = await readFile(join(import.meta.dir, '../../..', path), 'utf8')
    const tokens = marked.lexer(markdown)
    const heading = tokens.find((token): token is Tokens.Heading => token.type === 'heading' && token.depth === 1)
    const list = tokens.find((token): token is Tokens.List => token.type === 'list' && token.ordered)
    if (!heading || !list?.items.length) throw new Error(`The ${slug} setup guide requires a title and numbered setup steps`)

    const parser = new marked.Parser()
    const steps = list.items.map((item) => {
      const inlineTokens = item.tokens.flatMap(token => 'tokens' in token ? token.tokens ?? [] : [])
      return parser.parseInline(inlineTokens, parser.textRenderer).replace(/\s+/g, ' ').trim()
    })
    return [provider, {
      label: heading.text,
      steps,
      language,
      url: `https://github.com/stacksjs/postline/blob/main/${path}`,
    }]
  })))
}
