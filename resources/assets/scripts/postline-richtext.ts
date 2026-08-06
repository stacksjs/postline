/**
 * Rich-text editing for long-form posts, on ts-medium-editor.
 *
 * The composer's textarea stays the source of truth. Around twenty places read
 * `textarea.value` — character counting, per-network variants, thread mode,
 * drafts, the publish payload — and rewriting all of them to read from a
 * contenteditable would be a large change with a lot of ways to be subtly
 * wrong.
 *
 * So the editor is a *view* over the textarea rather than a replacement for
 * it. It mounts alongside, and every change is serialized back to Markdown
 * with `toMarkdown` and written into the textarea, which then dispatches its
 * normal `input` event. Every existing consumer keeps working, unmodified, and
 * the stored body stays the Markdown the blog and the newsletter already
 * expect.
 *
 * Only long-form gets it. A 300-character Bluesky post does not want a
 * formatting toolbar, and the Markdown a rich editor emits would be published
 * literally by networks that do not render it.
 */

import { isEmptyHtml, toMarkdown } from 'ts-medium-editor'
import { mountMediumEditor } from 'ts-medium-editor/stx'

/** Minimal Markdown to HTML, for seeding the editor from an existing draft. */
function markdownToHtml(markdown: string): string {
  const escape = (value: string): string => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  return markdown
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean)
    .map((block) => {
      const heading = block.match(/^(#{1,6})\s+(.*)$/)
      if (heading) {
        const level = heading[1].length
        return `<h${level}>${escape(heading[2])}</h${level}>`
      }
      if (block.startsWith('> ')) {
        return `<blockquote><p>${escape(block.replace(/^>\s?/gm, ''))}</p></blockquote>`
      }
      // Single newlines inside a block are soft wraps, which is what <br> is.
      return `<p>${escape(block).replace(/\n/g, '<br>')}</p>`
    })
    .join('')
}

function setupRichText(): void {
  const root = document.querySelector('[data-postline-page="composer"]')
  if (!root) return

  const textarea = root.querySelector<HTMLTextAreaElement>('[data-bluesky-text]')
  const host = root.querySelector<HTMLElement>('[data-richtext-host]')
  const toggle = root.querySelector<HTMLElement>('[data-richtext-toggle]')
  if (!textarea || !host) return

  let teardown: (() => void) | null = null
  let syncing = false

  const unmount = (): void => {
    teardown?.()
    teardown = null
    host.classList.add('hidden')
    textarea.classList.remove('hidden')
  }

  const mount = (): void => {
    if (teardown) return

    host.innerHTML = ''
    const surface = document.createElement('div')
    surface.className = 'min-h-36 w-full leading-relaxed text-[18px] text-ink outline-none medium-editor-element'
    host.appendChild(surface)

    // Seed from whatever the writer already had, so switching modes never
    // costs them a draft.
    surface.innerHTML = markdownToHtml(textarea.value)

    host.classList.remove('hidden')
    textarea.classList.add('hidden')

    teardown = mountMediumEditor({
      element: surface,
      // The textarea already carries the draft, and the composer persists it.
      // A second copy in localStorage would be a second source of truth.
      storageKey: false,
      editorOptions: { placeholder: { text: 'Write the piece…' } },
      onChange(html: string) {
        if (syncing) return
        syncing = true
        textarea.value = isEmptyHtml(html) ? '' : toMarkdown(html)
        // The composer listens on `input` for counting, variants and drafts.
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
        syncing = false
      },
    })
  }

  // Long-form is signalled by the title field being visible, which the
  // composer already toggles when the blog is a selected target. Reading that
  // rather than re-deriving it keeps one definition of "this is an essay".
  const title = root.querySelector<HTMLElement>('[data-compose-title]')
  const isLongForm = (): boolean => Boolean(title && !title.classList.contains('hidden'))

  const sync = (): void => {
    if (isLongForm()) mount()
    else unmount()
  }

  if (title) {
    // The composer toggles the title's `hidden` class rather than firing an
    // event, so the class is what there is to observe.
    new MutationObserver(sync).observe(title, { attributes: true, attributeFilter: ['class'] })
  }

  toggle?.addEventListener('click', () => {
    if (teardown) unmount()
    else mount()
  })

  sync()
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupRichText)
else setupRichText()

// Re-run after client-side navigation, since the composer is swapped in by the
// stx router rather than reloaded.
document.addEventListener('stx:navigated', setupRichText)

export { markdownToHtml, setupRichText }
