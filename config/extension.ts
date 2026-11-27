import { join } from 'node:path'
import { CSSGenerator, defaultConfig, Scanner } from '@cwcss/crosswind'
import { defineExtension } from '@stacksjs/browser-extension'

const popup = 'resources/extension/popup.stx'

export default defineExtension({
  name: 'Share to Postline',
  description: 'Open the current page in your Postline composer.',
  targets: ['chrome', 'firefox'],
  geckoId: 'postline-share@stacksjs.org',
  public: 'resources/extension/public',
  icons: { 32: 'icons/icon-32.png', 128: 'icons/icon-128.png' },
  actionIcons: { 32: 'icons/icon-32.png' },
  outdir: { chrome: 'dist-extension/chrome', firefox: 'dist-extension/firefox' },
  pages: { popup: { template: popup, script: 'resources/extension/share.ts' } },
  manifest: { permissions: ['activeTab', 'storage'] },
  hooks: {
    async postBuild({ cwd, outdir }) {
      const classes = await new Scanner([]).scanFile(join(cwd, popup))
      const css = new CSSGenerator({ ...defaultConfig, darkMode: 'media' })
      css.generateBatch([...classes])
      await Bun.write(join(outdir, 'styles.css'), css.toCSS(true, true))
    },
  },
})
