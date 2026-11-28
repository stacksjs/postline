import type { AccountStatus, ProviderStatus } from './social-client'
import { providerIcon, providerLabel } from './networks'
import { formatHandle, targetLabel } from './social-client'

export interface ComposerTarget extends ProviderStatus {
  key: string
  account: AccountStatus | null
  multi: boolean
}

/** Keep each connected account selectable, including two accounts on one network. */
export function composerTargets(providers: readonly ProviderStatus[]): ComposerTarget[] {
  return providers.flatMap<ComposerTarget>((status) => {
    const live = (status.accounts || []).filter(account => account.connected)
    if (live.length <= 1 && live[0]?.transport !== 'browser') {
      const account = live[0] ?? null
      return [{ ...status, key: account ? `${status.provider}:${account.id}` : status.provider, account, multi: false }]
    }
    return live.map(account => ({
      ...status,
      key: `${status.provider}:${account.id}`,
      canPublish: account.canPublish,
      handle: account.handle,
      account,
      multi: true,
    }))
  })
}

export function uniqueComposerNetworks<T extends { provider: string }>(targets: readonly T[]): T[] {
  return targets.filter((target, index) => targets.findIndex(other => other.provider === target.provider) === index)
}

export function composerSelection(connected: readonly ComposerTarget[], selected: readonly string[]): string[] {
  if (selected.length) {
    const keys = new Set(connected.map(target => target.key))
    return selected.filter(key => keys.has(key))
  }
  return connected.filter(target => !target.multi || target.account?.isDefault).map(target => target.key)
}

export function composerKeyForSpec(targets: readonly ComposerTarget[], spec: string): string | null {
  const exact = targets.find(target => target.key === spec)
  if (exact) return exact.key
  if (spec.includes(':')) return null
  const candidates = targets.filter(target => target.provider === spec && target.account?.transport !== 'browser')
  return (candidates.find(target => target.account?.isDefault) ?? candidates[0])?.key ?? null
}

export function composerTargetRows(targets: readonly ComposerTarget[], selected: readonly string[], overTargets: readonly ComposerTarget[]) {
  const overKeys = new Set(overTargets.map(target => target.key))
  return targets.map((target) => {
    const connected = Boolean(target.canPublish)
    const isSelected = connected && selected.includes(target.key)
    const network = providerLabel(target.provider)
    const over = isSelected && overKeys.has(target.key)
    return {
      key: target.key,
      icon: target.multi ? providerIcon(target.provider) : '',
      label: target.account?.transport === 'browser' ? `X browser ${formatHandle(target.provider, target.account.handle)}` : target.multi ? formatHandle(target.provider, target.account?.handle) : network,
      connected,
      selected: isSelected,
      over,
      title: !connected
        ? `Open Channels to connect ${network}.`
        : over
          ? `Too long for ${network}. Shorten this version before publishing.`
          : target.multi ? targetLabel(target.provider, target.account?.handle) : '',
    }
  })
}
