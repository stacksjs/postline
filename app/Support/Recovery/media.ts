import { Database } from 'bun:sqlite'
import { copyFile, lstat, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { referencedMediaFiles } from '../Social/stored-content'
import { isSafeMediaFilename } from '../Social/uploads'

function requiredMedia(databasePath: string): Set<string> {
  const database = new Database(databasePath, { readonly: true })
  try {
    const posts = database.query<{ stored: string | null }, []>(`
      SELECT COALESCE(posts.content, posts.notes) AS stored
      FROM posts
      WHERE posts.status IN ('draft', 'scheduled', 'publishing', 'failed')
        OR (posts.status = 'published' AND EXISTS (
          SELECT 1 FROM post_targets WHERE post_targets.post_id = posts.id AND post_targets.status = 'failed'
        ))
    `).all()
    return new Set(posts.flatMap(post => referencedMediaFiles(post.stored)))
  }
  finally {
    database.close()
  }
}

/** Read references from the exact database that will be uploaded or restored. */
export async function verifyRecoveryMedia(databasePath: string, directory: string): Promise<void> {
  for (const name of requiredMedia(databasePath)) {
    const file = await lstat(join(directory, name)).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return null
    })
    if (!file?.isFile()) throw new Error('The recovery set is missing an image needed by a queued post.')
  }
}

export async function captureRecoveryMedia(databasePath: string, source: string, directory: string): Promise<void> {
  await mkdir(directory, { mode: 0o700 })
  for (const file of await readdir(source, { withFileTypes: true })) {
    if (!file.isFile() || !isSafeMediaFilename(file.name)) continue
    try {
      await copyFile(join(source, file.name), join(directory, file.name))
    }
    catch (error) {
      // An unreferenced image can disappear while the queue is active.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  await verifyRecoveryMedia(databasePath, directory)
}
