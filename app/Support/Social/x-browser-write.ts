export interface XBrowserImage {
  type: string
  base64: string
  altText?: string
}

export interface XBrowserWrite {
  token: string
  profile: string
  handle: string
  text: string
  images: XBrowserImage[]
  replies?: string[]
}

export type XBrowserWriteResult =
  | { state: 'published', id: string }
  | { state: 'thread', ids: string[], attention?: true }
  | { state: 'refused' | 'uncertain' | 'attention' | 'layout' | 'unavailable' }

export function xBrowserPostId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value)
}
