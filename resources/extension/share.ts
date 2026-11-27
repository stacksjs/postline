import { shareablePage, shareComposerPath, shareWorkspace } from '../functions/composer-share'

interface ExtensionBrowser {
  tabs: {
    query: (filter: { active: true, currentWindow: true }) => Promise<Array<{ url?: string }>>
    create: (options: { url: string }) => Promise<unknown>
  }
  storage: {
    local: {
      get: (key: string) => Promise<Record<string, unknown>>
      set: (value: Record<string, string>) => Promise<void>
    }
  }
}

const api = globalThis as typeof globalThis & { browser?: ExtensionBrowser, chrome?: ExtensionBrowser }
const extension = (api.browser ?? api.chrome)!
const form = document.querySelector<HTMLFormElement>('#share-form')!
const workspace = form.querySelector<HTMLInputElement>('input[name="workspace"]')!
const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!
const pageLabel = document.querySelector<HTMLElement>('#shared-page')!
const status = document.querySelector<HTMLElement>('#share-error')!

const preference = 'workspace'
let page: string | null = null

async function prepareShare(): Promise<void> {
  try {
    const [[tab], saved] = await Promise.all([
      extension.tabs.query({ active: true, currentWindow: true }),
      extension.storage.local.get(preference),
    ])
    const address = saved[preference]
    if (typeof address === 'string') workspace.value = address
    page = shareablePage(tab?.url)
    pageLabel.textContent = page ?? 'Open a web page before sharing.'
    submit.disabled = !page
  }
  catch {
    pageLabel.textContent = 'Could not read the current tab. Open the extension again to retry.'
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (!page || submit.disabled) return
  status.textContent = ''
  const origin = shareWorkspace(workspace.value.trim())
  if (!origin) {
    status.textContent = 'Enter your workspace’s HTTPS address.'
    workspace.focus()
    return
  }
  submit.disabled = true
  try {
    await extension.storage.local.set({ [preference]: origin })
    await extension.tabs.create({ url: origin + shareComposerPath(page) })
    window.close()
  }
  catch {
    status.textContent = 'Could not open Composer. Try again.'
  }
  finally {
    submit.disabled = false
  }
})

void prepareShare()
