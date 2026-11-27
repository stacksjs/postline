import './lib/site-waitlist'

/**
 * The marketing header's disclosure menus (#232).
 *
 * They are `<details name="site-menu">`, so they open from a click or the
 * keyboard with no script, and opening one closes the other. What `<details>`
 * does not do on its own: close on Escape, close on a click elsewhere, and
 * close when the router swaps the page in under a header that stays put.
 */
const MENUS = 'details[name="site-menu"]'

function openMenus(): HTMLDetailsElement[] {
  return [...document.querySelectorAll<HTMLDetailsElement>(`${MENUS}[open]`)]
}

function closeAll(except?: Element | null): void {
  for (const menu of openMenus()) {
    if (except && menu.contains(except)) continue
    menu.open = false
  }
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return
  const [open] = openMenus()
  if (!open) return
  closeAll()
  // Focus goes back to the menu's own button, where the keyboard user was.
  open.querySelector('summary')?.focus()
})

document.addEventListener('click', (event) => {
  const target = event.target as Element | null
  // A link inside a menu takes the visitor somewhere: the menu's job is done.
  if (target?.closest(`${MENUS} a`)) closeAll()
  else closeAll(target)
})

window.addEventListener('stx:load', () => closeAll())
window.addEventListener('pageshow', () => closeAll())
