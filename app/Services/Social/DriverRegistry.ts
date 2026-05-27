import type { SocialDriver, SocialProvider } from '../../Support/Social/types'
import { env } from '@stacksjs/env'
import { BlueskyDriver } from './Drivers/BlueskyDriver'
import { InstagramDriver } from './Drivers/InstagramDriver'
import { LinkedInDriver } from './Drivers/LinkedInDriver'

const drivers: Partial<Record<SocialProvider, SocialDriver>> = {
  bluesky: new BlueskyDriver(),
  linkedin: new LinkedInDriver({ apiVersion: String(env.LINKEDIN_API_VERSION || '202405') }),
  instagram: new InstagramDriver({ graphVersion: String(env.INSTAGRAM_GRAPH_VERSION || 'v21.0') }),
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
