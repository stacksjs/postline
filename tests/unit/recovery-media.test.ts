import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureRecoveryMedia, verifyRecoveryMedia } from '../../app/Support/Recovery/media'

test('recovery keeps earlier queued images even when the live copy changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'postline-recovery-media-'))
  const databasePath = join(directory, 'snapshot.sqlite')
  const database = new Database(databasePath)
  try {
    database.exec(`
      CREATE TABLE posts (id INTEGER PRIMARY KEY, status TEXT, content TEXT, notes TEXT);
      CREATE TABLE post_targets (post_id INTEGER, status TEXT);
      INSERT INTO post_targets VALUES (2, 'failed'), (3, 'published');
    `)
    const write = database.prepare('INSERT INTO posts VALUES (?, ?, ?, ?)')
    const image = (name: string) => JSON.stringify({ media: [{ path: name }] })
    write.run(1, 'scheduled', image('queued.jpg'), null)
    write.run(2, 'published', null, image('retry.jpg'))
    write.run(3, 'published', image('sent.jpg'), null)

    const source = join(directory, 'live')
    const staged = join(directory, 'staged')
    await mkdir(source)
    await Bun.write(join(source, 'queued.jpg'), 'queued bytes')
    // A published image with a failed network can still be needed on retry.
    await expect(captureRecoveryMedia(databasePath, source, join(directory, 'incomplete'))).rejects.toThrow('missing an image')

    await Bun.write(join(source, 'retry.jpg'), 'retry bytes')
    await captureRecoveryMedia(databasePath, source, staged)
    await rm(join(source, 'queued.jpg'))
    await verifyRecoveryMedia(databasePath, staged)
    expect(await Bun.file(join(staged, 'queued.jpg')).text()).toBe('queued bytes')
    expect(await Bun.file(join(staged, 'retry.jpg')).text()).toBe('retry bytes')

    await rm(join(staged, 'retry.jpg'))
    await expect(verifyRecoveryMedia(databasePath, staged)).rejects.toThrow('missing an image')
  }
  finally {
    database.close()
    await rm(directory, { recursive: true, force: true })
  }
})
