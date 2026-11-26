import { describe, expect, it } from 'bun:test'
import { openLabel } from '../../resources/assets/scripts/lib/open-label'

// The toast after publishing named Bluesky whatever the network was (#166).
describe('the link on a published-post toast', () => {
  it('names the network the post went to', () => {
    expect(openLabel('https://bsky.app/profile/a.bsky.social/post/3k')).toBe('Open on Bluesky')
    expect(openLabel('https://x.com/someone/status/1')).toBe('Open on X')
    expect(openLabel('https://twitter.com/someone/status/1')).toBe('Open on X')
    expect(openLabel('https://www.linkedin.com/feed/update/urn:li:share:1')).toBe('Open on LinkedIn')
    expect(openLabel('https://www.threads.net/@someone/post/abc')).toBe('Open on Threads')
    expect(openLabel('https://www.instagram.com/p/abc/')).toBe('Open on Instagram')
  })

  it('says "Open post" for a server it cannot name, and for a link it cannot read', () => {
    expect(openLabel('https://mastodon.social/@someone/1')).toBe('Open post')
    expect(openLabel('not a url')).toBe('Open post')
  })

  it('is not fooled by a host that only ends in a network name', () => {
    expect(openLabel('https://notbsky.app/post')).toBe('Open post')
  })
})
