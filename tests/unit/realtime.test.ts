import { describe, expect, test } from 'bun:test'
import { DISCOVER_CHANNEL, discoverChannelFor } from '../../app/Support/Realtime/discover'
import { commentChannel } from '../../app/Services/CommentService'

describe('realtime channels', () => {
  test('each feed has its own channel, plus a combined one', () => {
    expect(discoverChannelFor('short')).toBe('discover.short')
    expect(discoverChannelFor('long')).toBe('discover.long')
    expect(DISCOVER_CHANNEL).toBe('discover')
    // A reader on the short feed must not receive long-form events.
    expect(discoverChannelFor('short')).not.toBe(discoverChannelFor('long'))
  })

  test('every post gets a distinct comment channel', () => {
    expect(commentChannel('blog:hello')).toBe('comments.blog:hello')
    expect(commentChannel('blog:a')).not.toBe(commentChannel('blog:b'))
  })
})

describe('client subscribe frame', () => {
  test('channel rides at the top level of the frame, not under data', () => {
    // ts-broadcasting's SubscribeMessage reads message.channel directly. A
    // nested `data.channel` leaves it undefined, and the server answers
    // subscription_error while the page keeps polling and looks fine.
    const view = pathToView()
    expect(view).toContain("event: 'subscribe', channel")
    expect(view).not.toContain("event: 'subscribe', data: { channel }")
  })

  test('the socket url carries the upgrade path the server listens on', () => {
    // A bare host is answered with a 404 rather than a 101.
    const view = pathToView()
    expect(view).toContain('/ws`')
    // https pages must use the gateway, never a bare port: a ws: connection
    // from an https page is blocked outright, and 6001 has no certificate.
    expect(view).toContain('wss://${window.location.host}/ws')
  })
})

function pathToView(): string {
  return require('node:fs').readFileSync(
    new URL('../../resources/views/discover.stx', import.meta.url).pathname,
    'utf8',
  )
}
