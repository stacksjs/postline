/**
 * Bundle the workspace's own browser scripts (`resources/assets/scripts/*.ts`).
 *
 * The layouts load them as `<script type="module" src="/assets/scripts/x.ts">`.
 * The dev server transpiles a `.ts` asset as it serves it; a built site has
 * no such server, so each script is bundled here, with whatever it imports
 * from npm, minified, for a browser. The desktop bundle and the web build
 * both use this, so the two cannot drift.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Every asset named by a template, including URLs used by dynamic imports. */
export function referencedClientScripts(root: string): string[] {
  const referenced = new Set<string>()
  for (const folder of ['resources/layouts', 'resources/views', 'resources/components']) {
    const glob = new Bun.Glob('**/*.stx')
    for (const file of glob.scanSync({ cwd: join(root, folder), absolute: true })) {
      for (const match of readFileSync(file, 'utf8').matchAll(/(['"])\/assets\/scripts\/([\w.-]+\.ts)\1/g))
        referenced.add(match[2]!)
    }
  }
  return [...referenced].sort()
}

/**
 * Scripts another script imports by URL (a `'/assets/scripts/x.ts'` string it
 * passes to `import()`) rather than a page loading them: code only one view needs, such as the
 * composer's editor, kept out of what every page downloads.
 */
export function lazyClientScripts(root: string, names: string[]): string[] {
  const dir = join(root, 'resources/assets/scripts')
  const lazy = new Set<string>()
  const queue = [...names]
  while (queue.length) {
    const source = readFileSync(join(dir, queue.pop()!), 'utf8')
    for (const match of source.matchAll(/'\/assets\/scripts\/([\w.-]+\.ts)'/g)) {
      if (names.includes(match[1]!) || lazy.has(match[1]!)) continue
      lazy.add(match[1]!)
      queue.push(match[1]!)
    }
  }
  return [...lazy].sort()
}

/**
 * Bundle each referenced script, and each script one of them imports by URL;
 * returns its code by file name. A URL import stays a URL import: the site
 * build points it at the hashed file, the desktop agent answers it as named.
 */
export async function bundleClientScripts(root: string): Promise<Record<string, string>> {
  const dir = join(root, 'resources/assets/scripts')
  const scripts: Record<string, string> = {}
  const referenced = referencedClientScripts(root)
  for (const name of [...referenced, ...lazyClientScripts(root, referenced)]) {
    const built = await Bun.build({ entrypoints: [join(dir, name)], target: 'browser', format: 'esm', minify: true, external: ['/assets/scripts/*'] })
    if (!built.success || built.outputs.length !== 1)
      throw new Error(`Could not bundle resources/assets/scripts/${name}:\n${built.logs.map(log => String(log)).join('\n')}`)
    scripts[name] = await built.outputs[0]!.text()
  }
  return scripts
}
