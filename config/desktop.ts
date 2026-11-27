import type { DesktopConfig } from '@stacksjs/types'
import process from 'node:process'
import { urlTo } from './domains'

export const RELEASE_UPDATE_PUBLIC_KEY = 'ed25519-public:MCowBQYDK2VwAyEA1IU_iC3XzydzrT8_VxIeWe8BCAzErUk9Psc5nbxK4gw'

/**
 * **Desktop**
 *
 * Postline as a Mac app that runs itself. The app's executable is a compiled
 * agent that serves the workspace and the API on a loopback port, and its
 * window is a web view pointed at that agent. Nothing is deployed for it to
 * open: the database, the access tokens and uploaded media are files in
 * `~/Library/Application Support/Postline`.
 *
 * It used to be a window around a deployed site (`DESKTOP_URL`), which meant a
 * download that did nothing until somebody had put Postline on a server.
 *
 * The agent's own code is `app/Desktop/Agent.ts`. `buddy dev:desktop` runs it
 * from source; `buddy build:desktop` compiles it.
 */
export default {
  webview: {
    appName: 'Postline',
    appId: 'org.stacksjs.postline',
    description: 'Write once, publish to every network.',
    // The holder named in LICENSE.md, so the app's About box and the licence agree.
    publisher: 'Open Web Foundation',
    homepage: 'https://github.com/stacksjs/postline',
    icon: 'app/Desktop/AppIcon.icns',
    window: {
      width: 1400,
      height: 900,
      // The workspace layout draws its own sidebar to the top edge, with the
      // window buttons over it. A system titlebar above that is a second,
      // empty title row.
      titlebarHidden: true,
      // The app's own storage, shared by its windows and kept across a quit.
      // Craft's default is a store per window that is emptied on quit: the
      // Settings window would open without the workspace's session, and the
      // theme, the sidebar and unsent drafts would be forgotten every launch.
      //
      // A menu-bar item, and the app stays running when its window closes
      // (#195): the agent and the scheduler live as long as Craft does, so a
      // post scheduled for later still goes out with the window closed.
      arguments: ['--persistent-storage', '--system-tray', '--keep-running'],
    },
    agent: {
      entry: 'app/Desktop/Agent.ts',
      prepare: 'app/Desktop/Prepare.ts',
      database: { filename: 'postline.sqlite' },
      config: true,
      appRoutes: true,
      views: 'resources/views',
      // The window opens on the workspace. `/` is the marketing site, which
      // is drawn for a browser and has no business inside the app.
      startPath: '/composer',
    },
    updates: {
      feedUrl: urlTo('/api/updates'),
      publicKeys: { main: RELEASE_UPDATE_PUBLIC_KEY },
      disk: process.env.POSTLINE_UPDATES_BUCKET ? 's3' : 'local',
    },
    macos: {
      minimumSystemVersion: '13.0',
      category: 'public.app-category.social-networking',
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSHumanReadableCopyright: 'Postline. MIT licensed.',
      },
    },
  },
} satisfies DesktopConfig
