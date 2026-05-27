export interface ProviderStatus {
  provider: string
  connected: boolean
  canPublish: boolean
  handle: string | null
  displayName?: string | null
  characterLimit: number
  authStatus: string
  configuredFromEnv?: boolean
  oauthConfigured?: boolean
}

export interface CrosspostResultItem {
  provider: string
  ok: boolean
  url?: string
  uri?: string
  error?: string
  targetId?: number
}

export interface CrosspostInput {
  text: string
  providers: string[]
  external?: { uri: string, title: string, description?: string }
  image?: { url: string, altText?: string }
}

const PROVIDER_LABELS: Record<string, string> = {
  bluesky: 'Bluesky',
  linkedin: 'LinkedIn',
  twitter: 'Twitter/X',
  mastodon: 'Mastodon',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
}

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] || provider.charAt(0).toUpperCase() + provider.slice(1)
}

export async function fetchProviders(): Promise<ProviderStatus[]> {
  const response = await fetch('/api/postline/providers')
  const payload = await response.json()
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Could not load connected accounts.')
  }
  return (payload.data?.providers || []) as ProviderStatus[]
}

export async function publishCrosspost(input: CrosspostInput): Promise<{ postId: number, results: CrosspostResultItem[] }> {
  const body = new FormData()
  body.set('text', input.text)
  body.set('providers', input.providers.join(','))
  if (input.external?.uri && input.external?.title) {
    body.set('external_uri', input.external.uri)
    body.set('external_title', input.external.title)
    body.set('external_description', input.external.description || '')
  }
  if (input.image?.url) {
    body.set('image_url', input.image.url)
    if (input.image.altText) body.set('image_alt', input.image.altText)
  }

  const response = await fetch('/api/postline/publish', { method: 'POST', body })
  const payload = await response.json()
  if (!payload?.data) {
    throw new Error(payload?.error || 'Publish failed.')
  }
  return payload.data as { postId: number, results: CrosspostResultItem[] }
}

declare global {
  interface Window {
    postlineSocial?: {
      fetchProviders: typeof fetchProviders
      publishCrosspost: typeof publishCrosspost
      providerLabel: typeof providerLabel
    }
  }
}

window.postlineSocial = {
  fetchProviders,
  publishCrosspost,
  providerLabel,
}
