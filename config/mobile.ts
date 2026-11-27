import type { MobileConfig } from '@stacksjs/types'
import { urlTo } from './domains'

export default {
  ios: {
    appName: 'Postline',
    bundleId: 'org.stacksjs.postline',
    version: '0.1.1',
    renderer: 'web',
    url: urlTo('/composer'),
    appIcon: 'resources/assets/images/app-icon.png',
    appearance: 'system',
    deviceFamilies: ['iphone'],
  },
} satisfies MobileConfig
