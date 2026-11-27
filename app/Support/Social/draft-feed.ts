import type { Element } from '@xmldom/xmldom'
import { createHash } from 'node:crypto'
import { DOMParser, onWarningStopParsing } from '@xmldom/xmldom'
import { UserFacingError } from '../Http/user-error'
import { stripHtml } from './text'
import { isPublicBase } from './uploads'

export interface DraftFeedItem {
  key: string
  title: string
  link: string | null
}

export function feedAddress(value: unknown): URL {
  const input = typeof value === 'string' ? value.trim() : ''
  const url = input.length <= 2048 ? URL.parse(input) : null
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || !isPublicBase(url.origin))
    throw new UserFacingError('Enter the full address of a public HTTP or HTTPS feed.')
  url.hash = ''
  if (url.href.length > 2048) throw new UserFacingError('Use a feed address of up to 2,048 characters.')
  return url
}

function cleanLink(value: string, base: URL): string | null {
  const url = value ? URL.parse(value, base) : null
  return url && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
    && url.href.length <= 2048 && isPublicBase(url.origin) ? url.href : null
}

function item(id: string, title: string, link: string | null): DraftFeedItem | null {
  const identity = id.trim() || link
  const name = stripHtml(title.slice(0, 2048)).replace(/\s+/g, ' ').trim().slice(0, 160)
  if (!identity || (!name && !link)) return null
  return { key: createHash('sha256').update(identity).digest('hex'), title: name || 'New feed item', link }
}

function children(node: Element | undefined, name: string): Element[] {
  return node ? Array.from(node.childNodes).filter((child): child is Element => child.nodeType === 1 && (child as Element).localName === name) : []
}

function text(node: Element | undefined, name: string): string {
  return children(node, name)[0]?.textContent?.trim() || ''
}

function baseOf(el: Element | undefined, base: URL): URL {
  return URL.parse(el?.getAttribute('xml:base') || '', base) || base
}

function xmlItems(source: string, base: URL): Array<DraftFeedItem | null> {
  // These feeds have no reason to carry a DTD. Refuse entity definitions and
  // external references before giving the document to the XML parser.
  if (/<!DOCTYPE\b/i.test(source)) throw new UserFacingError('Feeds with XML document types are unsupported.')
  let root: Element | null
  try { root = new DOMParser({ onError: onWarningStopParsing }).parseFromString(source, 'text/xml').documentElement }
  catch { throw new UserFacingError('The feed contains invalid XML.') }
  if (!root) throw new UserFacingError('The feed is empty.')
  const rootBase = baseOf(root, base)
  if (root.localName === 'feed') {
    return children(root, 'entry').map((entry) => {
      const link = children(entry, 'link').find(node => node.hasAttribute('href') && (!node.hasAttribute('rel') || node.getAttribute('rel') === 'alternate'))
      return item(text(entry, 'id'), text(entry, 'title') || text(entry, 'summary'), cleanLink(link?.getAttribute('href') || '', baseOf(link, baseOf(entry, rootBase))))
    })
  }
  const channel = root.localName === 'rss' ? children(root, 'channel')[0] : root.localName === 'RDF' ? root : undefined
  if (!channel) throw new UserFacingError('This address must return an RSS, Atom, or JSON feed.')
  const channelBase = channel === root ? rootBase : baseOf(channel, rootBase)
  return children(channel, 'item').map((entry) => {
    const guid = children(entry, 'guid')[0]
    const anchor = children(entry, 'link')[0]
    const guidUrl = guid?.textContent?.trim() || ''
    const permalink = guid?.getAttribute('isPermaLink') !== 'false' && /^https?:\/\//i.test(guidUrl) ? guidUrl : ''
    const href = anchor?.textContent?.trim() || permalink
    return item(guid?.textContent || '', text(entry, 'title') || text(entry, 'description'), cleanLink(href, baseOf(anchor, baseOf(entry, channelBase))))
  })
}

function jsonItems(source: string, base: URL): Array<DraftFeedItem | null> {
  let feed: { version?: unknown, items?: unknown }
  try { feed = JSON.parse(source) }
  catch { throw new UserFacingError('The feed contains invalid JSON.') }
  if (typeof feed?.version !== 'string' || !/^https:\/\/jsonfeed\.org\/version\/1(?:\.1)?$/.test(feed.version) || !Array.isArray(feed.items))
    throw new UserFacingError('This address must return an RSS, Atom, or JSON feed.')
  return feed.items.map((entry) => {
    if (!entry || typeof entry !== 'object') return null
    const value = (key: string) => typeof entry[key] === 'string' ? entry[key] : ''
    return item(value('id'), value('title') || value('summary') || value('content_text'), cleanLink(value('url') || value('external_url'), base))
  })
}

export function parseDraftFeed(bytes: Uint8Array, url: URL): DraftFeedItem[] {
  const source = new TextDecoder().decode(bytes).trim()
  const items = source.startsWith('{') ? jsonItems(source, url) : xmlItems(source, url)
  const seen = new Set<string>()
  return items.filter((entry): entry is DraftFeedItem => {
    if (!entry || seen.has(entry.key)) return false
    seen.add(entry.key)
    return true
  })
}
