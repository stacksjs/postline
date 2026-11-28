// Runs in the isolated X Composer window. Reopen the image editor to confirm
// that X kept every description before the local agent can authorize a send.
export async function saveXImageDescriptions(page: Document, composer: Element, descriptions: string[]): Promise<boolean> {
  const cutoff = Date.now() + 10_000
  let opener: HTMLElement | undefined
  const action = (scope: ParentNode, label: RegExp): HTMLElement | undefined => {
    const matches = Array.from(scope.querySelectorAll<HTMLElement>('button, [role="button"]'))
      .filter(control => control.getClientRects().length && label.test(control.getAttribute('aria-label') || control.innerText.trim()))
    return matches.length === 1 ? matches[0] : undefined
  }
  const canClick = (button: HTMLElement | undefined): button is HTMLElement =>
    Boolean(button && !button.matches(':disabled, [aria-disabled="true"]'))
  const editor = (): HTMLTextAreaElement | undefined => {
    const fields = Array.from(page.querySelectorAll<HTMLTextAreaElement>(
      '[role="dialog"] textarea[data-testid="altTextInput"], [role="dialog"] textarea[placeholder="Description"]',
    ))
      .filter(field => field.getClientRects().length && !field.readOnly && !field.disabled)
    return fields.length === 1 ? fields[0] : undefined
  }
  const picture = (dialog: Element): string | undefined => {
    const images = Array.from(dialog.querySelectorAll('img')).filter(image => image.getClientRects().length)
    return images.length === 1 ? images[0]?.currentSrc || images[0]?.src : undefined
  }
  async function until<T>(check: () => T | undefined): Promise<T | undefined> {
    while (Date.now() < cutoff && composer.isConnected) {
      const result = check()
      if (result !== undefined) return result
      await new Promise(resolve => setTimeout(resolve, 80))
    }
    return undefined
  }
  async function edit(verify: boolean): Promise<boolean> {
    const button = await until(() => {
      const label = verify ? /^(?:add description|edit description|[1-4] image descriptions?)$/i : /^add description$/i
      const control = verify && opener?.isConnected && opener.getClientRects().length ? opener : action(composer, label)
      return canClick(control) ? control : undefined
    })
    if (!button) return false
    opener = button
    button.click()
    let field = await until(editor)
    if (!field) return false
    const first = field.closest('[role="dialog"]')!
    if (canClick(action(first, /^previous(?: image)?$/i))) return false
    for (const [index, description] of descriptions.entries()) {
      const dialog = field.closest('[role="dialog"]')!
      if (verify) {
        if (field.value !== description) return false
      }
      else {
        if (field.value) return false
        if (description) {
          field.focus()
          page.execCommand('insertText', false, description)
          if (field.value !== description) return false
        }
      }

      const next = action(dialog, /^next(?: image)?$/i)
      if (index === descriptions.length - 1) {
        if (canClick(next)) return false
        const save = action(dialog, /^save$/i)
        if (!canClick(save)) return false
        save.click()
        return Boolean(await until(() => editor() ? undefined : true))
      }
      const current = picture(dialog)
      if (!current || !canClick(next)) return false
      next.click()
      field = await until(() => {
        const candidate = editor()
        const scope = candidate?.closest('[role="dialog"]')
        const selected = scope && picture(scope)
        return selected && selected !== current ? candidate : undefined
      })
      if (!field) return false
    }
    return false
  }

  return await edit(false) && await edit(true)
}
