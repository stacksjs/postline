import { urlTo } from '../../../config/domains'

export function marketingHead(path: string, card = '/images/og/home.png') {
  const canonical = urlTo(path)
  const image = urlTo(card)

  return {
    link: [{ rel: 'canonical', href: canonical }],
    meta: [
      { property: 'og:url', content: canonical },
      { property: 'og:image', content: image },
      { name: 'twitter:image', content: image },
    ],
  }
}
