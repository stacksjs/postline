/** Mount the lazy long-form editor against the composer's controlled textarea. */
import { sanitize } from '@stacksjs/sanitizer'
import { marked } from 'marked'
import { isEmptyHtml, toMarkdown } from 'ts-medium-editor'
import { mountMediumEditor } from 'ts-medium-editor/stx'
import { safeMarkdown } from '../../../app/Support/Social/safe-markdown'

/** Seed or refresh an editor from the Markdown stored in a draft. */
function renderDraft(surface: HTMLElement, markdown: string): void {
  const html = marked.parse(safeMarkdown(markdown), { async: false, breaks: true })
  // security-ignore: code/inner-html The Markdown renderer's output passes through the shared sanitizer.
  surface.innerHTML = sanitize(html, 'markdown').trim()
}

const boundComposers = new WeakSet<HTMLElement>()

function setupRichText(): void {
  const root = document.querySelector<HTMLElement>('[data-postline-page="composer"]')
  if (!root || boundComposers.has(root)) return
  const posts = root.querySelector('[data-composer-posts]')
  const title = root.querySelector('[data-compose-title]')
  if (!posts || !title) return
  boundComposers.add(root)

  let mountedField: HTMLTextAreaElement | null = null
  let unmount = () => {}

  function mount(field: HTMLTextAreaElement, host: HTMLElement): void {
    const surface = document.createElement('div')
    surface.className = 'min-h-36 w-full leading-relaxed text-[18px] text-ink outline-none medium-editor-element'
    surface.setAttribute('role', 'textbox')
    surface.setAttribute('aria-multiline', 'true')
    surface.setAttribute('aria-label', field.getAttribute('aria-label') || 'Post body')
    surface.setAttribute('data-focus-outline', '')
    renderDraft(surface, field.value)
    host.replaceChildren(surface)
    host.classList.remove('hidden')
    field.classList.add('hidden')
    mountedField = field

    let applyingModel = false
    const teardown = mountMediumEditor({
      element: surface,
      storageKey: false,
      editorOptions: { placeholder: { text: 'Write the piece…' } },
      onChange(html: string) {
        if (applyingModel || field.readOnly) return
        field.value = isEmptyHtml(html) ? '' : toMarkdown(html)
        field.dispatchEvent(new Event('input', { bubbles: true }))
      },
    })

    function updateFromModel(event: Event): void {
      const value: unknown = (event as CustomEvent).detail
      if (typeof value !== 'string') return
      applyingModel = true
      try { renderDraft(surface, value) }
      finally { applyingModel = false }
    }

    function focus(event: Event): void {
      event.preventDefault()
      surface.focus()
    }

    const updateReadonly = () => {
      surface.setAttribute('contenteditable', String(!field.readOnly))
      surface.setAttribute('aria-readonly', String(field.readOnly))
    }
    const readOnly = new MutationObserver(updateReadonly)
    readOnly.observe(field, { attributes: true, attributeFilter: ['readonly'] })
    updateReadonly()
    field.addEventListener('postline:composer-text', updateFromModel)
    field.addEventListener('postline:composer-focus', focus)
    unmount = () => {
      readOnly.disconnect()
      field.removeEventListener('postline:composer-text', updateFromModel)
      field.removeEventListener('postline:composer-focus', focus)
      teardown()
      host.replaceChildren()
      host.classList.add('hidden')
      field.classList.remove('hidden')
      mountedField = null
      unmount = () => {}
    }
  }

  const sync = (): void => {
    if (title.classList.contains('hidden')) {
      unmount()
      return
    }
    const host = posts.querySelector<HTMLElement>('[data-richtext-host]')
    const field = host?.closest('[data-composer-post]')?.querySelector<HTMLTextAreaElement>('[data-bluesky-text]')
    if (!host || !field || field === mountedField) return
    unmount()
    mount(field, host)
  }

  const observer = new MutationObserver(sync)
  observer.observe(title, { attributes: true, attributeFilter: ['class'] })
  observer.observe(posts, { childList: true, subtree: true })
  const disposeAfterNavigation = (): void => {
    if (root.isConnected) return
    observer.disconnect()
    unmount()
    window.removeEventListener('stx:load', disposeAfterNavigation)
  }
  window.addEventListener('stx:load', disposeAfterNavigation)
  sync()
}

// view-code.ts imports this module the first time a composer is on the page
// and calls setupRichText itself, on that load and after each navigation.
export { setupRichText }
