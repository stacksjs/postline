/**
 * Turn the built site's client scripts into JavaScript a static host can serve.
 *
 *   bun scripts/bundle-client-scripts.ts [dist]
 *
 * Runs after `buddy build:frontend` (see the `build` script). The stx build
 * copies `resources/assets/scripts/*.ts` into `dist/` as raw TypeScript and
 * leaves the pages pointing at them, and `richtext.ts` imports an npm package
 * by name: a static host can run none of it. Each script is bundled and
 * minified to `<name>.<hash>.js`, every page is pointed at that file, and the
 * `.ts` copies are removed. The hash changes with the code, so the files can
 * be cached for good.
 *
 * Until stx does this itself as part of its build.
 */
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { bundleClientScripts } from './lib/client-scripts'

const root = resolve(import.meta.dir, '..')
const dist = resolve(root, process.argv[2] || 'dist')
const scriptsDir = join(dist, 'assets/scripts')

if (!existsSync(dist)) {
  console.error(`No build at ${dist}. Run the frontend build first.`)
  process.exit(1)
}

const bundled = await bundleClientScripts(root)
const renamed = new Map<string, string>()
for (const [name, code] of Object.entries(bundled)) {
  const hash = Bun.hash(code).toString(36).slice(0, 10)
  const file = `${name.replace(/\.ts$/, '')}.${hash}.js`
  writeFileSync(join(scriptsDir, file), code)
  renamed.set(`/assets/scripts/${name}`, `/assets/scripts/${file}`)
}

// Point every page at the bundles.
let pages = 0
const glob = new Bun.Glob('**/*.html')
for (const file of glob.scanSync({ cwd: dist, absolute: true })) {
  const html = readFileSync(file, 'utf8')
  const next = html.replace(/(src=")(\/assets\/scripts\/[\w.-]+\.ts)(")/g, (match, open: string, path: string, close: string) => {
    const target = renamed.get(path)
    return target ? `${open}${target}${close}` : match
  })
  if (next !== html) {
    writeFileSync(file, next)
    pages++
  }
}

// A page still naming a .ts file would load nothing; say so rather than ship it.
const left: string[] = []
for (const file of glob.scanSync({ cwd: dist, absolute: true })) {
  if (/src="\/assets\/scripts\/[\w.-]+\.ts"/.test(readFileSync(file, 'utf8'))) left.push(file.slice(dist.length + 1))
}

for (const name of readdirSync(scriptsDir)) {
  if (name.endsWith('.ts')) rmSync(join(scriptsDir, name))
}

if (left.length) {
  console.error(`These pages still load a TypeScript file no script was bundled for:\n  ${left.join('\n  ')}`)
  process.exit(1)
}
console.log(`Bundled ${renamed.size} client script(s) and pointed ${pages} page(s) at them.`)
