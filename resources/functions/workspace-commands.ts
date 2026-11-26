export interface WorkspaceCommand {
  label: string
  context?: string
  shortcut?: string
  target: HTMLElement
}

const actionSelector = 'a[href], button, summary, select, textarea, input, [contenteditable="true"], [role="button"], [role="tab"], [role="switch"], [role="menuitem"]'
const textFields = 'input:not([type="button"],[type="submit"],[type="reset"],[type="checkbox"],[type="radio"],[type="file"]), textarea, select, [contenteditable="true"]'

function cleanLabel(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

function labelledBy(element: HTMLElement): string {
  return (element.getAttribute('aria-labelledby') ?? '').split(/\s+/)
    .map(id => cleanLabel(element.ownerDocument.getElementById(id)?.textContent)).filter(Boolean).join(' ')
}

function commandLabel(element: HTMLElement): string {
  const explicit = cleanLabel(element.dataset.commandLabel || labelledBy(element) || element.getAttribute('aria-label'))
  if (explicit) return explicit
  if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
    const label = Array.from(element.labels ?? [], item => cleanLabel(item.textContent)).join(' ')
    if (label) return label
    return cleanLabel(element.getAttribute('placeholder') || element.title)
  }
  return cleanLabel(element.innerText || element.title)
}

function commandContext(element: HTMLElement): string {
  const row = element.closest<HTMLElement>('article, li, [data-command-context], [role="group"]')
  if (!row) return ''
  const context = row.dataset.commandContext || row.getAttribute('aria-label') || row.querySelector('h2, h3, h4, [data-command-title]')?.textContent
  return cleanLabel(context).slice(0, 96)
}

function actionable(element: HTMLElement): boolean {
  return !element.matches(':disabled, [aria-disabled="true"]')
    && !element.closest('[inert], [aria-hidden="true"], [data-command-dialog], [data-command-ignore]')
    && element.getClientRects().length > 0
    && element.ownerDocument.defaultView?.getComputedStyle(element).visibility === 'visible'
}

export function workspaceCommands(dialog: HTMLDialogElement, navigationOnly = false): WorkspaceCommand[] {
  const document = dialog.ownerDocument
  const navigation = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[data-command-destination]'), target => ({
    label: cleanLabel(target.dataset.commandDestination), context: 'Go to view', shortcut: target.dataset.commandShortcut, target,
  }))
  // A palette opened above another modal can reach the controls in that
  // modal. The native dialog still prevents access to the page beneath it.
  const modal = Array.from(document.querySelectorAll<HTMLElement>('dialog:modal, [role="dialog"][aria-modal="true"]'))
    .filter(actionable).at(-1)
  if (navigationOnly) return modal ? [] : navigation

  const destinations = new Set(navigation.map(({ target }) => target.href))
  const scope = modal ?? dialog.closest<HTMLElement>('[data-postline-app]') ?? document.body
  const actions: WorkspaceCommand[] = []
  for (const target of scope.querySelectorAll<HTMLElement>(actionSelector)) {
    if (!actionable(target) || target.hasAttribute('data-command-destination')) continue
    if (target instanceof HTMLAnchorElement && destinations.has(target.href) && target.closest('[data-postline-sidebar], [data-postline-mobile-nav]')) continue
    const label = commandLabel(target)
    if (label) actions.push({ label: label.slice(0, 120), context: commandContext(target), target })
  }
  return modal ? actions : [...navigation, ...actions]
}

export function runWorkspaceCommand(command: WorkspaceCommand): void {
  const { target } = command
  if (!target.isConnected || target.matches(':disabled, [aria-disabled="true"]')) return
  if (target.matches(textFields)) {
    target.focus()
    if (target instanceof HTMLSelectElement && target.matches(':enabled')) {
      try { target.showPicker?.() }
      catch { /* Focus alone still opens the select from the keyboard. */ }
    }
  }
  else {
    target.focus()
    target.click()
  }
}
