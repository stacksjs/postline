import type { BunPressOptions } from '@stacksjs/bunpress'
import { url as siteUrl } from './domains'

/**
 * Postline's documentation site, built from docs/ by BunPress.
 *
 * It carried the Stacks framework's own docs config: titled "Stacks
 * Documentation", with Stacks' sidebar, social links and sitemap host (#68).
 * The sidebar lists only pages that exist; the user guides (install,
 * connecting each network, using and running Postline) join it as they are
 * written (#227, #228, #229).
 */
const config: BunPressOptions = {
  verbose: false,
  docsDir: './docs',
  outDir: './dist/docs',

  nav: [
    { text: 'Releases', link: 'https://github.com/stacksjs/postline/releases' },
    { text: 'Source', link: 'https://github.com/stacksjs/postline' },
  ],

  markdown: {
    title: 'Postline',
    meta: {
      description: 'How to install, connect and run Postline, the open-source social media scheduler that runs with your own keys.',
      author: 'Postline',
    },
    syntaxHighlightTheme: 'github-dark',
    toc: {
      enabled: true,
      minDepth: 2,
      maxDepth: 3,
    },
    sidebar: {
      '/': [
        {
          text: 'Getting started',
          items: [
            { text: 'Install the Mac app', link: '/install-mac' },
            { text: 'Run it on a server', link: '/self-hosting' },
            { text: 'First run', link: '/first-run' },
            { text: 'Upgrading', link: '/upgrading' },
          ],
        },
        {
          text: 'Connecting networks',
          items: [
            { text: 'Overview', link: '/networks/' },
            { text: 'Bluesky', link: '/networks/bluesky' },
            { text: 'Mastodon', link: '/networks/mastodon' },
            { text: 'LinkedIn', link: '/networks/linkedin' },
            { text: 'Threads', link: '/networks/threads' },
            { text: 'Instagram', link: '/networks/instagram' },
            { text: 'X', link: '/networks/x' },
          ],
        },
        {
          text: 'How it is built',
          items: [
            { text: 'The Mac app', link: '/desktop' },
          ],
        },
        {
          text: 'Contributing',
          items: [
            { text: 'CI and releases', link: '/ci' },
            { text: 'Release checklist', link: '/releasing' },
          ],
        },
      ],
    },
    themeConfig: {
      logo: '/favicon.svg',
      footer: {
        message: 'Released under the MIT License.',
        copyright: 'Copyright Open Web Foundation.',
      },
      socialLinks: [
        { icon: 'github', link: 'https://github.com/stacksjs/postline' },
      ],
    },
  },

  sitemap: {
    enabled: true,
    baseUrl: `${siteUrl.replace(/\/+$/, '')}/docs`,
  },

  robots: {
    enabled: true,
  },
}

export default config
