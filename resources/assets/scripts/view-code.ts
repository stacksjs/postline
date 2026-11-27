/** Load the long-form editor when Composer first shows its Blog title field. */
const editorUrl = new URL('/assets/scripts/richtext-editor.ts', import.meta.url)
let loaded: Promise<typeof import('./richtext-editor')> | undefined
let composer: HTMLElement | null = null
let observer: MutationObserver | undefined

function watchComposer(): void {
  const root = document.querySelector<HTMLElement>('[data-postline-page="composer"]')
  if (root === composer) return
  observer?.disconnect()
  observer = undefined
  composer = root

  const title = root?.querySelector('[data-compose-title]')
  if (!root || !title) return
  const load = () => {
    if (root !== composer || title.classList.contains('hidden')) return
    observer?.disconnect()
    observer = undefined
    const pending = loaded ??= import(editorUrl.href)
    void pending.then(({ setupRichText }) => {
      if (root === composer && root.isConnected) setupRichText(root)
    }).catch((error) => {
      // Keep the plain editor available and retry on the next visit.
      if (loaded === pending) loaded = undefined
      console.error('The Blog editor did not load.', error)
    })
  }
  observer = new MutationObserver(load)
  observer.observe(title, { attributes: true, attributeFilter: ['class'] })
  load()
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchComposer, { once: true })
else watchComposer()

// The persistent layout stays in place across workspace navigation.
window.addEventListener('stx:load', watchComposer)
