interface NetworkAppearance {
  label: string
  icon?: string
  color?: string
  initial?: string
}

const networks: Record<string, NetworkAppearance> = {
  bluesky: { label: 'Bluesky', icon: 'i-simple-icons-bluesky', color: 'bg-net-bluesky' },
  mastodon: { label: 'Mastodon', icon: 'i-simple-icons-mastodon', color: 'bg-net-mastodon' },
  twitter: { label: 'X', icon: 'i-simple-icons-x', color: 'bg-net-x' },
  linkedin: { label: 'LinkedIn', icon: 'i-simple-icons-linkedin', initial: 'in' },
  instagram: { label: 'Instagram', icon: 'i-simple-icons-instagram', color: 'bg-net-instagram' },
  threads: { label: 'Threads', icon: 'i-simple-icons-threads' },
  facebook: { label: 'Facebook' },
  tiktok: { label: 'TikTok' },
  blog: { label: 'Blog', icon: 'i-hugeicons-quill-write-02', initial: 'W' },
}

function appearance(provider: string): NetworkAppearance | undefined {
  return Object.hasOwn(networks, provider) ? networks[provider] : undefined
}

export function providerLabel(provider: string | null | undefined): string {
  if (!provider) return ''
  return appearance(provider)?.label ?? provider.charAt(0).toUpperCase() + provider.slice(1)
}

export function providerInitial(provider: string): string {
  return appearance(provider)?.initial ?? providerLabel(provider).charAt(0).toUpperCase()
}

export function providerColor(provider: string): string {
  return appearance(provider)?.color ?? 'bg-net-bluesky'
}

export function providerIcon(provider: string): string {
  return appearance(provider)?.icon ?? 'i-hugeicons-share-08'
}
