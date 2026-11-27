/** Enhance the marketing signup form, including forms reached by site navigation. */
document.addEventListener('submit', async (event) => {
  const form = event.target
  if (!(form instanceof HTMLFormElement) || !form.matches('[data-waitlist-form]')) return
  const button = form.querySelector<HTMLButtonElement>('button[type=submit]')
  const status = form.querySelector<HTMLElement>('[role=status]')
  if (!button || !status) return
  event.preventDefault()
  if (button.disabled) return

  const show = (message: string, failed = false) => {
    status.toggleAttribute('data-error', failed)
    status.textContent = message
  }

  const body = new FormData(form)
  const address = String(body.get('email') || '').trim()
  // Avoid using one of the endpoint's allowed attempts on an obvious typo.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    show('Enter a valid email address.', true)
    return
  }

  body.set('email', address)
  const label = button.textContent
  button.disabled = true
  button.textContent = 'Adding…'
  show('')
  try {
    const response = await fetch(form.action, {
      method: 'POST',
      headers: { accept: 'application/json' },
      body,
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok || payload?.success !== true)
      throw new Error(typeof payload?.message === 'string' ? payload.message : 'That did not go through. Try again in a moment.')
    show(payload.pending ? 'Check your inbox and confirm your email.' : 'You are on the list.')
    form.reset()
  }
  catch (error) {
    show(error instanceof Error ? error.message : String(error), true)
  }
  finally {
    button.disabled = false
    button.textContent = label
  }
})
