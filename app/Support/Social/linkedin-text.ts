/**
 * LinkedIn's API version and post text format, from `@stacksjs/socials`.
 *
 * These lived here until they moved into the framework
 * (stacksjs/stacks@917822555c). The names stay so the services, and the test
 * that fails two months before the pinned version is retired, keep working.
 */
export {
  LINKEDIN_API_VERSION,
  escapeLinkedInText as linkedInCommentary,
  linkedInVersionSunset,
  resolveLinkedInVersion,
} from '@stacksjs/socials'
