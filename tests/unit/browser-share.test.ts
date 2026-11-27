import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { buildExtension } from '@stacksjs/browser-extension'
import config from '../../config/extension'
import { shareablePage, shareComposerPath, sharedPage, shareWorkspace } from '../../resources/functions/composer-share'

describe('browser share links', () => {
  test('preserves the shared URL’s own search and fragment inside the handoff', () => {
    const url = 'https://example.org/article?q=red+blue#details'
    const path = shareComposerPath(url)
    expect(path).toStartWith('/composer#postline-share=')
    expect(new URL(path, 'https://workspace.example.org').search).toBe('')
    expect(sharedPage(new URL(path, 'https://workspace.example.org').hash)).toBe(url)
  })

  test('rejects unsupported and credential-bearing shared URLs', () => {
    expect(shareablePage('file:///private/article')).toBeNull()
    expect(shareablePage('https://user:pass@example.org/')).toBeNull()
    expect(sharedPage('#postline-share=' + encodeURIComponent('data:text/html,example'))).toBeNull()
    expect(sharedPage('#postline-share=' + 'a'.repeat(5000))).toBeNull()
    expect(sharedPage('#section')).toBeNull()
  })

  test('takes only HTTPS workspace origins and local HTTP development origins', () => {
    expect(shareWorkspace('https://workspace.example.org/')).toBe('https://workspace.example.org')
    expect(shareWorkspace('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000')
    expect(shareWorkspace('http://workspace.example.org')).toBeNull()
    expect(shareWorkspace('https://workspace.example.org/another-app')).toBeNull()
    expect(shareWorkspace('https://user@workspace.example.org')).toBeNull()
    expect(shareWorkspace('https://workspace.example.org/?forward=1')).toBeNull()
  })
})

test('the framework builds a permission-scoped extension with its complete popup', async () => {
  const root = resolve(import.meta.dir, '../..')
  const scratch = mkdtempSync(join(tmpdir(), 'postline-extension-test-'))
  try {
    for (const target of ['chrome', 'firefox'] as const) {
      const { outdir } = await buildExtension(config, { target, version: '0.0.0', cwd: root, outdir: join(scratch, target) })
      const manifest = await Bun.file(join(outdir, 'manifest.json')).json()
      expect(manifest).toMatchObject({
        manifest_version: 3,
        permissions: ['activeTab', 'storage'],
        action: { default_popup: 'popup.html' },
        content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
      })
      expect(manifest.host_permissions).toBeUndefined()
      expect(manifest.content_scripts).toBeUndefined()
      expect(manifest.background).toBeUndefined()
      for (const path of Object.values(manifest.icons) as string[])
        expect(await Bun.file(join(outdir, path)).exists()).toBe(true)
      const html = await Bun.file(join(outdir, 'popup.html')).text()
      expect(html).toContain('src="popup.js"')
      expect(html).toContain('href="styles.css"')
      expect(html.match(/<script\b/g)).toHaveLength(1)
      expect((await Bun.file(join(outdir, 'styles.css')).text()).length).toBeGreaterThan(0)
    }
  }
  finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})
