import type { FilesystemsConfig } from '@stacksjs/types'
import process from 'node:process'

const bucket = process.env.POSTLINE_UPDATES_BUCKET
const accessKeyId = process.env.POSTLINE_UPDATES_ACCESS_KEY_ID
const secretAccessKey = process.env.POSTLINE_UPDATES_SECRET_ACCESS_KEY

export default {
  ...(bucket ? {
    s3: {
      bucket,
      region: process.env.POSTLINE_UPDATES_REGION || 'us-east-1',
      credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
    },
  } : {}),
} satisfies FilesystemsConfig
