/**
 * Load the code one view needs only when that view is on the page (#180).
 *
 * Every workspace page loads this file, because the router swaps views in
 * under a layout that stays put: a visit from Queue to the composer runs no
 * new layout script. The long-form editor (about 30 KB with ts-medium-editor)
 * and the analytics chart are each used by one view, so each is imported the
 * first time its view appears, and started again after every navigation that
 * lands on it. Queue, Inbox and the rest never download either.
 *
 * Each URL is absolute. The dev server and the desktop agent answer it as
 * they answer every other script, and the site build bundles the file on its
 * own and rewrites the URL to the hashed name (scripts/lib/client-scripts.ts),
 * which is why each one is written out as a plain string.
 */
interface ViewCode {
  /** Present on the page when the view is. */
  selector: string
  url: string
  /** The export to call once the module is in. */
  start: string
}

const VIEWS: ViewCode[] = [
  { selector: '[data-postline-page="composer"] [data-richtext-host]', url: '/assets/scripts/richtext-editor.ts', start: 'setupRichText' },
  { selector: '[data-analytics-chart]', url: '/assets/scripts/analytics-chart.ts', start: 'mountAnalyticsIfShown' },
]

const loaded = new Map<string, Promise<Record<string, unknown>>>()

function startViews(): void {
  for (const view of VIEWS) {
    if (!document.querySelector(view.selector)) continue
    let module = loaded.get(view.url)
    if (!module) {
      module = import(/* @vite-ignore */ view.url) as Promise<Record<string, unknown>>
      loaded.set(view.url, module)
    }
    module
      .then((exports) => {
        const start = exports[view.start]
        if (typeof start === 'function') start()
      })
      .catch((error) => {
        // The view still works without it (the composer's textarea, the
        // analytics numbers); say why the extra is missing, and try again on
        // the next visit.
        console.error(`${view.url} did not load.`, error)
        loaded.delete(view.url)
      })
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startViews, { once: true })
else startViews()

// The router fires `stx:load` on window once a navigated-to page is in place.
window.addEventListener('stx:load', startViews)
