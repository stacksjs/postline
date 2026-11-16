/**
 * Prove the desktop agent works, as the compiled binary the app ships.
 *
 * Unit tests run the agent's code from source, inside the project, where the
 * framework can find everything it looks for on disk. The app is neither: it
 * is one compiled binary started somewhere with no project around it, and the
 * failures that matter only happen there. Routes that answered from source
 * answered 500 once compiled, because their middleware could not be loaded,
 * and the workspace's scripts were served as TypeScript the web view refused.
 *
 * So this is compiled and run from an empty directory:
 *
 *   bun scripts/desktop-bundle.ts
 *   bun build --compile scripts/desktop-check.ts --outfile /tmp/postline-check
 *   (cd /tmp && ./postline-check)
 *
 * It starts the agent on a fresh data directory, publishes a post and saves a
 * draft through the real API, and reads them back from the database. Exit
 * code 0 means every check passed. The release workflow runs it before it
 * images the app.
 */
import { Database } from 'bun:sqlite'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import agent from '../app/Desktop/Agent'

const dataDir = mkdtempSync(join(tmpdir(), 'postline-desktop-check-'))
const origin = 'http://127.0.0.1:4999'
const context = { appName: 'Postline', version: '0.0.0', origin, port: 4999, dataDir }
const failures: string[] = []

function check(what: string, passed: boolean, detail = ''): void {
  // eslint-disable-next-line no-console
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${what}${!passed && detail ? `: ${detail}` : ''}`)
  if (!passed) failures.push(what)
}

async function call(method: string, path: string, form?: Record<string, string>): Promise<{ status: number | null, type: string, text: string }> {
  const body = form
    ? Object.entries(form).reduce((data, [key, value]) => (data.set(key, value), data), new FormData())
    : undefined
  const response = await agent.fetch!(new Request(`${origin}${path}`, { method, body, headers: { origin } }), context as never) as Response | undefined

  return {
    status: response ? response.status : null,
    type: response?.headers.get('content-type')?.split(';')[0] ?? '',
    text: response ? await response.text() : '',
  }
}

await agent.start!({ ...context, launch: { args: [], cwd: dataDir } } as never)

check('the working directory is the data directory', existsSync(join(process.cwd(), 'app.key')))
check('the app key is private', (statSync(join(dataDir, 'app.key')).mode & 0o777) === 0o600)

const page = await call('GET', '/composer')
check('a page is left to the built views', page.status === null)

const front = await call('GET', '/')
check('the landing page sends the window to the workspace', front.status === 302)

const script = await call('GET', '/assets/scripts/social.ts')
check('a workspace script is served as JavaScript', script.status === 200 && script.type === 'text/javascript' && !/\binterface\s+\w+\s*\{/.test(script.text), `${script.status} ${script.type}`)

for (const path of ['/api/v1/status', '/api/postline/providers', '/api/postline/queue', '/api/postline/accounts', '/api/postline/analytics', '/api/postline/campaigns', '/api/postline/listening', '/api/postline/settings/retention']) {
  const read = await call('GET', path)
  check(`GET ${path}`, read.status === 200, `${read.status} ${read.text.slice(0, 160)}`)
}

const published = await call('POST', '/api/postline/publish', { text: 'Published by the desktop check.', title: 'Desktop check', providers: 'blog' })
check('publishing to the blog', published.status === 200 && JSON.parse(published.text)?.data?.results?.[0]?.ok === true, `${published.status} ${published.text.slice(0, 200)}`)

const draft = await call('POST', '/api/postline/queue', { text: 'A draft kept by the desktop check.', providers: 'blog' })
check('saving a draft', draft.status === 200 && JSON.parse(draft.text)?.data?.status === 'draft', `${draft.status} ${draft.text.slice(0, 200)}`)

const database = new Database(join(dataDir, 'postline.sqlite'), { readonly: true })
const posts = database.query('SELECT status FROM posts ORDER BY id').all() as Array<{ status: string }>
const blog = database.query('SELECT slug FROM blog_posts').all() as Array<{ slug: string }>
const ledger = (database.query('SELECT count(*) AS count FROM migrations').get() as { count: number }).count
database.close()

check('both posts are in the database', posts.map(post => post.status).join(',') === 'published,draft', JSON.stringify(posts))
check('the blog post is recorded', blog.length === 1 && blog[0]!.slug === 'desktop-check', JSON.stringify(blog))
check('the database carries its migration ledger', ledger > 0, String(ledger))
check('the blog file is in the data directory', existsSync(join(dataDir, 'content/blog')) && readdirSync(join(dataDir, 'content/blog')).includes('desktop-check.md'))

await agent.stop?.()
rmSync(dataDir, { recursive: true, force: true })

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`)
  process.exit(1)
}

// eslint-disable-next-line no-console
console.log('\nThe desktop agent works as a compiled binary.')
process.exit(0)
