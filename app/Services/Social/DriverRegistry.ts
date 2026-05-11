import type { SocialDriver, SocialProvider } from '../../Support/Social/types'
import { BlueskyDriver } from './Drivers/BlueskyDriver'

const drivers: Partial<Record<SocialProvider, SocialDriver>> = {
  bluesky: new BlueskyDriver(),
}

export function getSocialDriver(provider: SocialProvider): SocialDriver {
  const driver = drivers[provider]

  if (!driver) {
    throw new Error(`Social driver "${provider}" is not installed yet.`)
  }

  return driver
}

export function listSocialDrivers(): SocialDriver[] {
  return Object.values(drivers).filter(Boolean) as SocialDriver[]
}
