/**
 * The marketing catalog: every feature and use-case page, in one place.
 *
 * Three things read from this and must not drift apart: the generated `.stx`
 * pages under `resources/views/{features,use-cases}`, the mega menu in the
 * marketing layout, and the OG card generated per page by
 * `scripts/marketing-og.ts`. Adding an entry here and re-running
 * `bun scripts/marketing-build.ts` is the whole workflow.
 */

export interface MarketingEntry {
  /** URL slug, also the .stx filename. */
  slug: string
  /** Nav label. Kept short so the mega menu stays on one line. */
  nav: string
  /** Page headline. Two lines max at desktop. */
  title: string
  /** Nav + card description, and the meta description. Under 25 words. */
  summary: string
  /** Iconify hugeicons slug, matching the rest of the app. */
  icon: string
  /** The opening paragraph. */
  intro: string
  /** Body sections. Each is a heading plus one paragraph. */
  sections: Array<{ heading: string, body: string }>
  /** Three supporting points, rendered as a divided list rather than cards. */
  points: string[]
}

export const FEATURES: MarketingEntry[] = [
  {
    slug: 'publications',
    nav: 'Publications',
    title: 'Your publication, on your domain',
    summary: 'Write long-form posts to a publication you own, at your own domain, with nothing sitting between you and the page.',
    icon: 'quill-write-02',
    intro: 'A The Open Times publication is a real website. Posts render at your domain, the archive belongs to you, and no host decides what the page looks like or who is allowed to reach it.',
    sections: [
      { heading: 'Long-form and short-form in one place', body: 'The composer switches between a social post and a full essay. Long pieces get a title, a slug and an archive entry, and they go live on your site the moment you publish.' },
      { heading: 'Your domain from the first post', body: 'Nothing is served from a platform subdomain, so the links you share today keep working if you move hosts, change tools, or stop using The Open Times entirely.' },
      { heading: 'Templates you can actually edit', body: 'The page templates are files in your project. Change the layout, the type and the colour, then redeploy. There is no theme marketplace and no approval step.' },
    ],
    points: [
      'One composer for essays and posts',
      'Custom domain from day one',
      'Templates you edit and redeploy yourself',
    ],
  },
  {
    slug: 'newsletter',
    nav: 'Newsletter',
    title: 'Every post, in every inbox',
    summary: 'Publishing a post emails it to your subscribers. The web page and the send are one action, not two tools.',
    icon: 'mail-01',
    intro: 'The gap between publishing a piece and sending it is where most writing tools lose people. In The Open Times they are the same action: the post goes live on your site and lands in your subscribers\' inboxes at once.',
    sections: [
      { heading: 'Publish is send', body: 'Choosing who receives a post is part of writing it, not a second job in a different product. Send to everyone, to paying subscribers only, or to nobody and leave it on the web.' },
      { heading: 'Your sending, your reputation', body: 'Mail goes out through a provider you configure: SES, Postmark, Resend or plain SMTP. The deliverability, the sending reputation and the per-email cost all stay yours.' },
      { heading: 'The list is a table you own', body: 'Subscribers live in your database next to your posts. Export the whole list as CSV whenever you like, because it was never being held anywhere else.' },
    ],
    points: [
      'One action publishes and sends',
      'Bring your own mail provider',
      'Export the full list at any time',
    ],
  },
  {
    slug: 'paid-subscriptions',
    nav: 'Paid subscriptions',
    title: 'Charge for it, keep all of it',
    summary: 'Turn on paid tiers, mark posts subscriber-only, and take payment straight into your own Stripe account.',
    icon: 'dollar-circle',
    intro: 'The Open Times takes no percentage, because there is no The Open Times in the middle to take one. Readers pay into your Stripe account, and the subscriber list that comes with them sits in your database rather than on somebody else\'s dashboard.',
    sections: [
      { heading: 'No platform cut', body: 'Your Stripe keys, your payouts, your customers. The only fee is the one Stripe charges you directly, which is the same fee you would pay running checkout yourself.' },
      { heading: 'Free and paid in one publication', body: 'Any post can be free, paid, or free for a while and paid afterwards. Readers see a preview and a subscribe prompt rather than a dead end.' },
      { heading: 'Leaving costs you nothing', body: 'Subscriptions live in your Stripe account, so moving away from The Open Times does not cancel a single one of them. There is no billing relationship to renegotiate.' },
    ],
    points: [
      'Monthly, annual and founding tiers',
      'Per-post paywall with a readable preview',
      'Payouts and customers stay in your Stripe',
    ],
  },
  {
    slug: 'discover',
    nav: 'Discover',
    title: 'Readers who already read',
    summary: 'Publications on the Open Times network recommend each other, so new readers arrive through someone they already trust.',
    icon: 'compass',
    intro: 'Writing independently is mostly the problem of being found at all. Discover is a shared index of The Open Times publications, ordered by what readers actually subscribe to rather than by who paid to appear in it.',
    sections: [
      { heading: 'Recommendations, not advertising', body: 'Writers point at the publications they read. A reader who subscribes to one sees the handful their writer vouches for, which is how most people find anything worth reading anyway.' },
      { heading: 'Ranked by readers', body: 'Position comes from subscriptions and reading time. There is no promoted slot to buy, so a small publication with devoted readers outranks a large one nobody opens.' },
      { heading: 'Listing is a choice', body: 'A publication is unlisted until you list it. Private newsletters, internal changelogs and small personal sites stay out of the index and out of search.' },
    ],
    points: [
      'Cross-recommendations between writers',
      'Ranked by subscriptions, never by spend',
      'Unlisted by default, listed when you say so',
    ],
  },
  {
    slug: 'comments',
    nav: 'Comments',
    title: 'The conversation stays with the post',
    summary: 'Threaded comments under every piece, open to the readers you choose, moderated by you and stored with your posts.',
    icon: 'comment-01',
    intro: 'A post that gets replies on four networks has its conversation scattered across four companies. Comments keep the discussion attached to the thing being discussed, in a table you can read.',
    sections: [
      { heading: 'Threads under the piece', body: 'Replies nest under the comment they answer, so a long disagreement stays readable instead of collapsing into a flat list of fragments.' },
      { heading: 'Open, or subscriber-only', body: 'Let anyone reply, restrict comments to subscribers, or restrict them to paying subscribers. The setting is per post, because not every piece wants the same room.' },
      { heading: 'Moderation without a queue to babysit', body: 'Block, delete and turn off replies from the post itself. Comments are rows in your database, so a bad week is a query rather than a support ticket.' },
    ],
    points: [
      'Threaded replies under every post',
      'Per-post access control',
      'Moderation from the post, not a separate console',
    ],
  },
  {
    slug: 'import',
    nav: 'Import',
    title: 'Bring the whole thing over',
    summary: 'Move posts, subscribers and paid subscriptions across in one import, without asking a single reader to sign up again.',
    icon: 'download-04',
    intro: 'Leaving a publishing platform usually means abandoning the archive and asking every reader to resubscribe. An import moves the posts, the list and the billing relationships together, in that order, in one pass.',
    sections: [
      { heading: 'The archive, with its links intact', body: 'Posts arrive with their titles, dates and slugs, and old URLs redirect to the new ones. Anything already linking to your writing keeps working.' },
      { heading: 'Subscribers, free and paying', body: 'The free list transfers as-is. Paid subscriptions move across in Stripe, so people keep the plan and the renewal date they already had and are never asked to enter a card again.' },
      { heading: 'Check it before you switch', body: 'An import runs into a publication that is not live yet. Read the result, fix what came across badly, and point your domain at it when you are satisfied.' },
    ],
    points: [
      'Posts, subscribers and billing in one pass',
      'Redirects so existing links survive',
      'Import first, switch the domain later',
    ],
  },
  {
    slug: 'crossposting',
    nav: 'Crossposting',
    title: 'One composer, six networks',
    summary: 'Announce what you publish everywhere at once, or post to Bluesky, X, LinkedIn, Instagram, Threads and Mastodon on their own.',
    icon: 'share-08',
    intro: 'A publication needs somewhere to send people from. The Open Times takes one draft, adapts it per network, and publishes to all of them in a single action, whether it is announcing an essay or just a post.',
    sections: [
      { heading: 'Publish in one pass', body: 'Pick the networks you want, write the post, and send it. Each target is published independently, so one provider failing never blocks the rest.' },
      { heading: 'Failures stay visible', body: 'A rejected post is recorded against the network that rejected it, with the provider\'s own error text. Nothing fails silently and nothing is retried behind your back.' },
    ],
    points: [
      'Six networks from one composer',
      'Per-target status, not a single success flag',
      'Threads chain automatically where the network supports replies',
    ],
  },
  {
    slug: 'scheduling',
    nav: 'Scheduling',
    title: 'Queue it now, publish it later',
    summary: 'Schedule posts ahead in your own timezone and let the queue publish them, or send immediately.',
    icon: 'calendar-03',
    intro: 'The queue is a plain list of what is going out and when. Drafts, scheduled posts, and failures all live in the same view, so there is one place to look before a launch.',
    sections: [
      { heading: 'Your timezone, not the server\'s', body: 'Each post carries the timezone it was written in, so a 9am slot stays 9am regardless of where the instance runs.' },
      { heading: 'Publish now when plans change', body: 'Anything in the queue can be sent immediately without rewriting it. The scheduled entry becomes a published one, keeping its history.' },
      { heading: 'What the queue needs', body: 'A scheduled post fires when The Open Times is running. On a laptop that means while the app is open; put it on a small always-on box and the queue keeps publishing overnight.' },
    ],
    points: [
      'Drafts, scheduled, publishing and failed in one list',
      'Per-post timezone',
      'Publish now without losing the draft',
    ],
  },
  {
    slug: 'per-network-variants',
    nav: 'Per-network variants',
    title: 'Different limits, same idea',
    summary: 'Override the text for any single network without maintaining six separate drafts of the same post.',
    icon: 'text-align-left',
    intro: 'X gives you 280 characters. Bluesky gives you 300, Mastodon 500, LinkedIn 3000. Writing to the tightest limit makes every post worse. Variants let one network differ without forking the draft.',
    sections: [
      { heading: 'Override only what needs it', body: 'The shared body is the default. Any network you give a variant to publishes that instead, and the rest keep inheriting, so a small tweak stays a small tweak.' },
      { heading: 'Counted against the right limit', body: 'The composer counts each variant against the character limit of the network it belongs to, so you find out before publishing rather than after.' },
    ],
    points: [
      'One shared body, optional per-network overrides',
      'Live character counts per network',
      'No duplicate drafts to keep in sync',
    ],
  },
  {
    slug: 'analytics',
    nav: 'Analytics',
    title: 'What actually landed',
    summary: 'Subscriber growth, revenue and per-network engagement against the posts that caused them, in one view.',
    icon: 'chart-line-data-01',
    intro: 'Most publishing tools show you opens and most social tools show you likes, and neither answers the only question worth asking: which piece of writing brought people in. The Open Times keeps both sets of numbers against the same post.',
    sections: [
      { heading: 'The post that won the subscriber', body: 'Signups and upgrades are attributed to the post a reader arrived on, so a piece that quietly converts is visible next to the one that merely got attention.' },
      { heading: 'Counts, attached to your posts', body: 'Social metrics are stored per published target, so a post that went to three networks keeps three separate sets of numbers rather than one blended total.' },
      { heading: 'Batched and rate-aware', body: 'Syncs run in batches against each provider\'s API, and posts deleted upstream are skipped rather than reported as errors.' },
    ],
    points: [
      'Subscribers and revenue attributed per post',
      'Likes, reposts and replies per network',
      'History survives an account going away',
    ],
  },
  {
    slug: 'bulk-delete',
    nav: 'Bulk delete',
    title: 'Take it all back down',
    summary: 'Delete every post from a connected account, on the networks whose APIs allow it, with a preview first.',
    icon: 'delete-02',
    intro: 'Leaving a network, or clearing an old account, normally means deleting posts one at a time. The Open Times removes them in bulk, and makes you look at exactly what will go before anything does.',
    sections: [
      { heading: 'Preview before anything is deleted', body: 'A dry run reports the exact count per network and a sample of what matched. The delete button stays locked until you have previewed the selection you are about to act on.' },
      { heading: 'Scoped to what you choose', body: 'Delete only the posts The Open Times published, or the account\'s entire history where the network lets you enumerate it. Providers that cannot delete are reported as skipped with the reason.' },
    ],
    points: [
      'Dry-run preview with per-network counts',
      'Typed confirmation phrase before any deletion',
      'Every run recorded in an audit log',
    ],
  },
  {
    slug: 'own-your-keys',
    nav: 'Own everything',
    title: 'Nobody holds your list',
    summary: 'Your posts, your subscribers, your revenue and your access tokens all live in a database you run. There is no vendor in the middle.',
    icon: 'key-01',
    intro: 'Every hosted publishing service holds the two things that matter: the relationship with your readers and permission to post as you. The Open Times is the same software with both of those in a database you control.',
    sections: [
      { heading: 'The audience is not rented', body: 'Subscribers, payments and posts are rows you can query, back up and export. A platform cannot change its terms on a list it does not have.' },
      { heading: 'Tokens stay where you put them', body: 'OAuth tokens and app passwords are encrypted with a key your instance generates. Nobody else has a copy, because there is nobody else.' },
      { heading: 'Run it wherever suits you', body: 'It is one Bun process and a SQLite file. That runs on a laptop, and it runs on a small server if you want the queue publishing while the laptop is shut.' },
    ],
    points: [
      'Subscribers and revenue in your own database',
      'Tokens encrypted with a key only you hold',
      'MIT licensed, so you can read every line',
    ],
  },
]

export const USE_CASES: MarketingEntry[] = [
  {
    slug: 'writers',
    nav: 'Writers',
    title: 'A publication you are not renting',
    summary: 'Publish essays to your own site, email them to your list, and promote each one across every network in one pass.',
    icon: 'quill-write-02',
    intro: 'Writing independently means the publication, the mailing list and the promotion are all your problem. Splitting them across three products means every piece is published three times, by hand, badly.',
    sections: [
      { heading: 'One piece, one publish', body: 'The essay goes live on your domain, lands in your subscribers\' inboxes and gets announced on every network you post to. That is one action, not an afternoon.' },
      { heading: 'The list is yours to leave with', body: 'Subscribers and paid plans sit in your own database and your own Stripe account. Changing tools later does not cost you a single reader.' },
      { heading: 'Found by people who already read', body: 'Discover surfaces publications through the writers their readers already trust, so growth does not depend on being loud on one network.' },
    ],
    points: [
      'Site, newsletter and social from one draft',
      'Subscribers and billing you own outright',
      'Recommendations from writers your readers follow',
    ],
  },
  {
    slug: 'paid-newsletters',
    nav: 'Paid newsletters',
    title: 'Keep the whole subscription',
    summary: 'Run a paid publication where the platform fee is zero, because there is no platform between you and your readers.',
    icon: 'dollar-circle',
    intro: 'A ten percent platform fee on a paid newsletter is a rent you pay forever on a relationship you built. Running the software yourself removes the fee and the intermediary at the same time.',
    sections: [
      { heading: 'The maths changes immediately', body: 'Readers pay into your Stripe account and you keep everything Stripe does not charge you for. On a list of any real size that difference is the cost of running the thing several times over.' },
      { heading: 'Move without asking permission', body: 'Import brings posts, free subscribers and active paid plans across together, keeping renewal dates intact so nobody is asked to enter a card again.' },
      { heading: 'Paywall the pieces worth paying for', body: 'Free posts do the reaching, paid posts do the earning, and each one is a per-post decision rather than a plan you commit to up front.' },
    ],
    points: [
      'No percentage taken by anyone but Stripe',
      'Import paid subscriptions without resubscribes',
      'Per-post paywall with a readable preview',
    ],
  },
  {
    slug: 'founders',
    nav: 'Founders',
    title: 'Ship the update everywhere',
    summary: 'Post launches, changelogs and build notes to every network without doing it six times.',
    icon: 'rocket-01',
    intro: 'Building in public means the same update has to reach people on whichever network they happen to use. That is repetitive work that scales with the number of networks, not with the value of the post.',
    sections: [
      { heading: 'Launch days stop being copy and paste', body: 'Write the announcement once, choose the networks, and schedule it. Follow-up posts through the week go into the same queue.' },
      { heading: 'Keep the record', body: 'Every published post and its engagement stays in your own database. A year of building in public stays readable even if you stop using a network.' },
    ],
    points: [
      'One draft, every network',
      'Schedule a launch week in advance',
      'Your posting history stays yours',
    ],
  },
  {
    slug: 'developer-advocates',
    nav: 'Developer advocates',
    title: 'Reach every community',
    summary: 'Developers are split across Bluesky, X and Mastodon. Reach all of them without choosing a favourite.',
    icon: 'user-group',
    intro: 'Technical audiences fragmented across networks, and no single one of them is where everyone is. Posting to only one means writing off part of your community.',
    sections: [
      { heading: 'Tuned per network', body: 'Mastodon and Bluesky reward a different register than LinkedIn. Per-network variants let one post read naturally on each without maintaining separate drafts.' },
      { heading: 'Measure where it worked', body: 'Engagement is stored per network, so it is obvious which communities respond to which kind of post rather than which network is loudest overall.' },
    ],
    points: [
      'Cover fragmented developer communities',
      'Adjust tone per network',
      'Per-network engagement, not a blended average',
    ],
  },
  {
    slug: 'open-source-maintainers',
    nav: 'Maintainers',
    title: 'Release notes that travel',
    summary: 'Announce releases across networks from a tool you can read, fork and audit before it touches your accounts.',
    icon: 'source-code',
    intro: 'Giving a closed service permission to post as you is a bigger ask than it looks. The Open Times is MIT licensed and runs on your own machine, so you can read exactly what it does before it gets that permission.',
    sections: [
      { heading: 'Announce a release once', body: 'Version announcements go to every network in one action, so shipping a release does not turn into a marketing chore.' },
      { heading: 'Software you can inspect', body: 'The whole codebase is readable and MIT licensed. If it does not do what you need, the fix is a pull request rather than a support ticket.' },
    ],
    points: [
      'MIT licensed, auditable end to end',
      'Runs on your machine, no account to create',
      'No vendor holding publish rights',
    ],
  },
  {
    slug: 'agencies',
    nav: 'Agencies',
    title: 'Accounts you actually control',
    summary: 'Manage posting for a handful of client accounts without a per-seat subscription or a vendor holding their tokens.',
    icon: 'building-03',
    intro: 'Scheduling tools price by seat and by account, and hold the access tokens for clients you are responsible for. Running the tool yourself removes both problems at once.',
    sections: [
      { heading: 'No per-seat pricing', body: 'Cost does not change with the number of accounts connected, because there is no vendor in the middle metering it.' },
      { heading: 'Clean handover', body: 'When an engagement ends, revoke the tokens and hand over the posting history. Nothing stays locked inside a platform the client cannot reach.' },
    ],
    points: [
      'Cost does not scale per seat',
      'Client tokens stay on hardware you control',
      'Bulk delete for clean account handover',
    ],
  },
]

/** Everything, for sitemap and OG generation. */
export const ALL_ENTRIES: Array<MarketingEntry & { kind: 'feature' | 'use-case', path: string }> = [
  ...FEATURES.map(entry => ({ ...entry, kind: 'feature' as const, path: `/features/${entry.slug}` })),
  ...USE_CASES.map(entry => ({ ...entry, kind: 'use-case' as const, path: `/use-cases/${entry.slug}` })),
]
