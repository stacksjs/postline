import process from 'node:process'

export interface BlogConfig {
  subdomain: string
  title: string
  description: string
  postsPerPage: number
  enableComments: boolean
  enableRss: boolean
  enableSitemap: boolean
  enableSearch: boolean
  social: {
    twitter?: string
    github?: string
  }
  theme: {
    primaryColor: string
    logo?: string
  }
}

/**
 * The public blog at /blog, which publishing to the Blog channel writes to.
 * It is the workspace owner's blog, so it carries no Stacks branding: the
 * title is `BLOG_TITLE`, else the app's name.
 */
const config: BlogConfig = {
  subdomain: 'blog',
  title: process.env.BLOG_TITLE || `${process.env.APP_NAME || 'Postline'} Blog`,
  description: process.env.BLOG_DESCRIPTION || '',
  postsPerPage: 10,
  enableComments: false,
  enableRss: true,
  enableSitemap: true,
  enableSearch: true,
  social: {},
  theme: {
    primaryColor: '#f0441e',
    logo: '/favicon.svg',
  },
}

export default config
