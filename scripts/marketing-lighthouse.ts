import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { spawnOwnedProcess } from '@stacksjs/cli/owned-process'
import { auditLighthouse, formatLighthouseResult } from '@stacksjs/testing/lighthouse'

const root = join(import.meta.dir, '..')
const dist = join(root, 'dist')
const homepage = await Bun.file(join(dist, 'index.html')).text()

const socket = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() })
const port = String(socket.port)
socket.stop(true)

const hostname = 'postline-audit.localhost'
const url = `http://${hostname}:${port}/`

async function waitForHomepage(): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { host: hostname, 'accept-encoding': 'gzip' },
      redirect: 'manual',
      signal: AbortSignal.timeout(2000),
    }).catch(() => null)
    if (response?.ok) {
      if (response.headers.get('content-encoding') !== 'gzip' || await response.text() !== homepage)
        throw new Error('The gateway must serve the exact homepage from the build with HTTP compression.')
      return
    }
    await Bun.sleep(250)
  }
  throw new Error('The gateway did not serve the Postline marketing homepage.')
}

// Use the production gateway for the static build, including its normal
// content encoding. The local listener never manages DNS or certificates.
const sites = await mkdtemp(join(tmpdir(), 'postline-lighthouse-'))
let server: ReturnType<typeof spawnOwnedProcess> | undefined
try {
  await Bun.write(join(sites, 'postline.json'), JSON.stringify({
    slug: 'postline',
    proxies: [{ id: 'postline', to: hostname, static: { dir: dist, spa: false, pathRewriteStyle: 'flat' }, cleanUrls: true }],
  }))
  server = spawnOwnedProcess(['bun', 'x', '--bun', '--no-install', 'rpx', 'gateway', '--sites-dir', sites, '--no-https', '--http-port', port], {
    cwd: root,
    env: { ...process.env, RPX_BIND_HOSTNAME: '127.0.0.1', RPX_VERBOSE: 'false' },
    stdout: 'inherit',
    stderr: 'inherit',
  })
  await Promise.race([
    waitForHomepage(),
    server.exited.then(({ code }) => { throw new Error(`The gateway stopped with status ${code}.`) }),
  ])
  const results = await auditLighthouse({
    urls: [url],
    device: 'both',
    minimum: 95,
    outputDir: join(root, 'test-results/marketing-lighthouse'),
    onResult: result => console.log(formatLighthouseResult(result)),
  })
  if (results.length !== 2 || results.some(result => !result.passed || result.finalUrl !== url))
    throw new Error('The marketing homepage must score at least 95 in every Lighthouse category on desktop and mobile.')
}
finally {
  await server?.stop()
  await rm(sites, { recursive: true, force: true })
}
