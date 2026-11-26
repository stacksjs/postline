/**
 * The road to 1.0, for the public roadmap page (#233): the production plan's
 * epics, each a tracking issue on GitHub where its progress is kept. The page
 * links to them rather than copying their state, so it cannot go stale.
 */
export interface RoadmapStage { title: string, summary: string, issue: number }

export const ROADMAP: RoadmapStage[] = [
  { title: 'Ground', summary: 'A repository that is safe to change, with everything that is not Postline removed.', issue: 49 },
  { title: 'Security', summary: 'No way in without signing in, passkeys and two-factor sign-in, and secure as shipped.', issue: 50 },
  { title: 'Engine', summary: 'A post goes out once, and a failure is visible and retried.', issue: 51 },
  { title: 'Networks', summary: 'Each network behaves the way its platform does.', issue: 52 },
  { title: 'Design system', summary: 'One type scale, one colour system, one set of components.', issue: 53 },
  { title: 'Views', summary: 'Every view complete in every state.', issue: 54 },
  { title: 'Speed', summary: 'Size and speed budgets enforced on a production build.', issue: 55 },
  { title: 'Mac app', summary: 'Notarized, updating itself, and keeping your data across upgrades.', issue: 56 },
  { title: 'Operations', summary: 'Hostable, observable and backed up.', issue: 57 },
  { title: 'Site and docs', summary: 'True claims, a way to get the app, and real documentation.', issue: 58 },
  { title: 'Launch', summary: 'Gated releases and a final security audit.', issue: 59 },
  { title: 'After 1.0', summary: 'Posting slots, video, recurring posts, an API and more.', issue: 60 },
]

export const REPOSITORY = 'https://github.com/stacksjs/postline'
