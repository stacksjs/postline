/**
 * Ambient types for Postline's client-side script blocks.
 *
 * Declared here, not exported and not imported. `.stx` script blocks may not
 * `import` a shared type (standards rule 10b): auto-imported symbols already
 * carry ambient declarations, and an `import` in a client block changes what
 * the bundler emits. A `.d.ts` with no top-level `import`/`export` is global by
 * definition, so every script block sees these for free.
 *
 * These describe what the BROWSER receives from `/api/postline/*`, which is a
 * flattened projection of the server types in `app/Support/Social/types.ts` —
 * deliberately a separate declaration, because the wire shape and the server
 * shape are free to diverge.
 *
 * Caveat worth knowing: nothing enforces these. `tsc --noEmit` cannot see
 * inside a `.stx` file, so they are editor support and documentation, not a
 * guarantee. That is an argument for fixing the toolchain, not for omitting
 * them — every `.stx` script block is compiled as TypeScript either way, and
 * an unannotated parameter is silently `any`.
 */

/** A queue entry as `/api/postline/queue/list` returns it. */
interface QueueApiItem {
  id: number
  status: string
  body: string
  title?: string | null
  createdAt?: string | null
  scheduledAt?: string | null
  publishedAt?: string | null
  hasImage?: boolean
  hasLink?: boolean
  providers: QueueApiTarget[]
}

/** One per-network result attached to a queue entry. */
interface QueueApiTarget {
  provider: string
  failureReason?: string | null
  remoteUri?: string | null
}

/** A queue entry flattened to exactly what one row renders. */
interface QueueRow {
  id: number
  status: string
  body: string
  when: string
  channels: string
  failure: string
  liveUrl: string
  editUrl: string
  actionable: boolean
  scheduledAt?: string | null
  publishedAt?: string | null
  title?: string | null
}

/** One calendar cell in the queue month grid. */
interface QueueCalCell {
  blank: boolean
  day?: number
  isToday?: boolean
  chips: QueueCalChip[]
}

interface QueueCalChip {
  id: number
  status: string
  label: string
}

/** Toast copy for a queue action's success branch. */
interface QueueActionCopy {
  title: string
  message: string
}

/** A timeline post as `/api/postline/timeline` returns it. */
interface TimelineApiItem {
  uri?: string | null
  postUrl?: string | null
  authorHandle?: string | null
  authorName?: string | null
  authorAvatar?: string | null
  postedAt?: string | null
  body?: string | null
  replyCount?: number | null
  repostCount?: number | null
  likeCount?: number | null
}

/** A timeline post flattened to exactly what one row renders. */
interface TimelineRow {
  handle: string
  name: string
  url: string
  avatar: string
  initials: string
  gradient: string
  postedAt: string
  relativeTime: string
  bodyHtml: string
  replies: string
  reposts: string
  likes: string
}

/**
 * The stored theme preference.
 *
 * `'system'`, not `'auto'` — the layout's pre-paint bootstrap matches on
 * `'system'`, and `useColorMode` cannot be used here because it only reads
 * localStorage after hydration begins (stacksjs/stx#1794) and writes a
 * hard-coded `light|dark|auto` vocabulary (stacksjs/stx#1788).
 */
type ThemePreference = 'light' | 'dark' | 'system'
