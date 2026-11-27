import { takeSharedPage } from '../../functions/composer-share'
import { showNotification } from '../../functions/notification'
import { fetchWorkspaceBootstrap } from '../../functions/postline-client'

export async function offerBrowserShare(composer: HTMLElement): Promise<void> {
  // Keep the handoff in the address until authentication succeeds. A 401
  // redirects to sign-in with the same fragment.
  await fetchWorkspaceBootstrap()
  if (!composer.isConnected) return
  const page = takeSharedPage()
  if (!page) return

  showNotification({
    title: 'Shared browser link',
    message: page,
    tone: 'info',
    id: 'browser-share',
    dedupeMs: 0,
    action: {
      label: 'Add link to post',
      dismiss: false,
      run: () => composer.dispatchEvent(new CustomEvent('postline:browser-share', { detail: page, bubbles: true })),
    },
  })
}
