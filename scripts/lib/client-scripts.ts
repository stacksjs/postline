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

/** Every script a layout, view or component references, by file name. */
export function referencedClientScripts(root: string): string[] {
  const referenced = new Set<string>()
  for (const folder of ['resources/layouts', 'resources/views', 'resources/components']) {
    const glob = new Bun.Glob('**/*.stx')
    for (const file of glob.scanSync({ cwd: join(root, folder), absolute: true })) {
      for (const match of readFileSync(file, 'utf8').matchAll(/src="\/assets\/scripts\/([\w.-]+\.ts)"/g))
        referenced.add(match[1]!)
    }
  }
  return [...referenced].sort()
}

/** Bundle each referenced script; returns its code by file name. */
export async function bundleClientScripts(root: string): Promise<Record<string, string>> {
  const dir = join(root, 'resources/assets/scripts')
  const scripts: Record<string, string> = {}
  for (const name of referencedClientScripts(root)) {
    const built = await Bun.build({ entrypoints: [join(dir, name)], target: 'browser', format: 'esm', minify: true })
    if (!built.success || built.outputs.length !== 1)
      throw new Error(`Could not bundle resources/assets/scripts/${name}:\n${built.logs.map(log => String(log)).join('\n')}`)
    scripts[name] = await built.outputs[0]!.text()
  }
  return scripts
}
