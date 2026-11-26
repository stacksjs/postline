/**
 * The label on a toast's link to a published post, named for its network.
 * It said "Open on Bluesky" for every network (#166).
 */
const NETWORK_HOSTS: Array<[RegExp, string]> = [
  [/(^|\.)bsky\.app$/, 'Bluesky'],
  [/(^|\.)(x|twitter)\.com$/, 'X'],
  [/(^|\.)linkedin\.com$/, 'LinkedIn'],
  [/(^|\.)threads\.(net|com)$/, 'Threads'],
  [/(^|\.)instagram\.com$/, 'Instagram'],
]

export function openLabel(url: string): string {
  try {
    const host = new URL(url).hostname
    const network = NETWORK_HOSTS.find(([pattern]) => pattern.test(host))?.[1]
    // A Mastodon server has a name of its own; the post is still a post.
    return network ? `Open on ${network}` : 'Open post'
  }
  catch {
    return 'Open post'
  }
}
