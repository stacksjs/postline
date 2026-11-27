import { Database } from 'bun:sqlite'
import { copyFile, lstat, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { readBlogAttachments } from '../Social/blog-attachments'
import { referencedMediaFiles } from '../Social/stored-content'
import { isSafeMediaFilename } from '../Social/uploads'

function requiredMedia(databasePath: string): Map<string, string> {
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
    const files = new Map(posts.flatMap(post => referencedMediaFiles(post.stored)).map(name => [name, 'a queued post']))
    if (database.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'recurring_posts'").get()) {
      const repeats = database.query<{ stored: string | null }, []>(`
        SELECT json_extract(segment.value, '$.content') AS stored
        FROM recurring_posts, json_each(recurring_posts.template, '$.segments') AS segment
      `).all()
      for (const repeat of repeats) {
        for (const name of referencedMediaFiles(repeat.stored)) files.set(name, 'a recurring post')
      }
    }
    const blogColumns = database.query<{ name: string }, []>('PRAGMA table_info(blog_posts)').all()
    if (blogColumns.some(column => column.name === 'attachments')) {
      const articles = database.query<{ attachments: string | null }, []>(`
        SELECT attachments FROM blog_posts WHERE status IN ('draft', 'published')
      `).all()
      for (const article of articles) {
        for (const attachment of readBlogAttachments(article.attachments)) files.set(attachment.file, 'a Blog article')
      }
    }
    return files
  }
  finally {
    database.close()
  }
}

/** Read references from the exact database that will be uploaded or restored. */
export async function verifyRecoveryMedia(databasePath: string, directory: string): Promise<void> {
  for (const [name, owner] of requiredMedia(databasePath)) {
    const file = await lstat(join(directory, name)).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return null
    })
    if (!file?.isFile()) throw new Error(`The recovery set is missing an image needed by ${owner}.`)
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
