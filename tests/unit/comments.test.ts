import type { CommentView } from '../../app/Services/CommentService'
import { describe, expect, test } from 'bun:test'
import { commentChannel, threadComments } from '../../app/Services/CommentService'

function comment(id: number, parentId: number | null = null): CommentView {
  return {
    id,
    parentId,
    authorName: `Reader ${id}`,
    body: `Comment ${id}`,
    status: 'visible',
    createdAt: '2026-08-05 12:00:00',
    supporter: false,
    replies: [],
  }
}

describe('comment threading', () => {
  test('top-level comments stay at the root', () => {
    const tree = threadComments([comment(1), comment(2)])
    expect(tree.map(node => node.id)).toEqual([1, 2])
    expect(tree.every(node => node.replies.length === 0)).toBe(true)
  })

  test('replies nest under the comment they answer', () => {
    const tree = threadComments([comment(1), comment(2, 1), comment(3, 2)])
    expect(tree).toHaveLength(1)
    expect(tree[0].replies.map(node => node.id)).toEqual([2])
    expect(tree[0].replies[0].replies.map(node => node.id)).toEqual([3])
  })

  test('an orphan is re-attached at the top rather than disappearing', () => {
    // Its parent was removed by moderation. Losing the reply with it would
    // silently delete somebody else's writing.
    const tree = threadComments([comment(1), comment(5, 99)])
    expect(tree.map(node => node.id).sort()).toEqual([1, 5])
  })

  test('an empty thread produces an empty tree', () => {
    expect(threadComments([])).toEqual([])
  })

  test('the input list is not mutated', () => {
    const rows = [comment(1), comment(2, 1)]
    threadComments(rows)
    expect(rows[0].replies).toEqual([])
  })
})

describe('comment channels', () => {
  test('each post gets its own realtime channel', () => {
    expect(commentChannel('blog:hello')).toBe('comments.blog:hello')
    expect(commentChannel('blog:a')).not.toBe(commentChannel('blog:b'))
  })
})
