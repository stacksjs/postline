export interface XBrowserImage {
  type: string
  base64: string
}

export interface XBrowserWrite {
  token: string
  profile: string
  handle: string
  text: string
  images: XBrowserImage[]
}

export type XBrowserWriteResult =
  | { state: 'published', id: string }
  | { state: 'refused' | 'uncertain' | 'attention' | 'layout' | 'unavailable' }

export function xBrowserPostId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value)
}
