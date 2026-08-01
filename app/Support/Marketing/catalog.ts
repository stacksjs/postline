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
    slug: 'crossposting',
    nav: 'Crossposting',
    title: 'One composer, six networks',
    summary: 'Write once and publish to Bluesky, X, LinkedIn, Instagram, Threads and Mastodon in a single pass.',
    icon: 'share-08',
    intro: 'Every network wants the same post in a slightly different shape. Postline takes one draft, adapts it per network, and publishes to all of them from a single action.',
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
      { heading: 'What the queue needs', body: 'A scheduled post fires when Postline is running. On a laptop that means while the app is open; put it on a small always-on box and the queue keeps publishing overnight.' },
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
    summary: 'Pull likes, reposts and replies back from the networks that report them, against the posts you published.',
    icon: 'chart-line-data-01',
    intro: 'Engagement lives on the network that hosts the post. Postline syncs those counts back and stores them against your own record, so the history is yours even if an account goes away.',
    sections: [
      { heading: 'Counts, attached to your posts', body: 'Metrics are stored per published target, so a post that went to three networks keeps three separate sets of numbers rather than one blended total.' },
      { heading: 'Batched and rate-aware', body: 'Syncs run in batches against each provider\'s API, and posts deleted upstream are skipped rather than reported as errors.' },
    ],
    points: [
      'Likes, reposts and replies per network',
      'History survives an account going away',
      'Batched syncs that respect provider rate limits',
    ],
  },
  {
    slug: 'bulk-delete',
    nav: 'Bulk delete',
    title: 'Take it all back down',
    summary: 'Delete every post from a connected account, on the networks whose APIs allow it, with a preview first.',
    icon: 'delete-02',
    intro: 'Leaving a network, or clearing an old account, normally means deleting posts one at a time. Postline removes them in bulk, and makes you look at exactly what will go before anything does.',
    sections: [
      { heading: 'Preview before anything is deleted', body: 'A dry run reports the exact count per network and a sample of what matched. The delete button stays locked until you have previewed the selection you are about to act on.' },
      { heading: 'Scoped to what you choose', body: 'Delete only the posts Postline published, or the account\'s entire history where the network lets you enumerate it. Providers that cannot delete are reported as skipped with the reason.' },
    ],
    points: [
      'Dry-run preview with per-network counts',
      'Typed confirmation phrase before any deletion',
      'Every run recorded in an audit log',
    ],
  },
  {
    slug: 'own-your-keys',
    nav: 'Own your keys',
    title: 'Nobody holds your tokens',
    summary: 'Your access tokens live in your own database, on your own machine. There is no vendor in the middle.',
    icon: 'key-01',
    intro: 'Every hosted crossposting service asks for write access to your social accounts and keeps those tokens on their servers. Postline is the same software with the tokens in a database you control.',
    sections: [
      { heading: 'Tokens stay where you put them', body: 'OAuth tokens and app passwords are encrypted with a key your instance generates. Nobody else has a copy, because there is nobody else.' },
      { heading: 'Run it wherever suits you', body: 'It is one Bun process and a SQLite file. That runs on a laptop, and it runs on a small server if you want the queue publishing while the laptop is shut.' },
    ],
    points: [
      'Tokens encrypted with a key only you hold',
      'One process and one file, no broker to run',
      'MIT licensed, so you can read every line',
    ],
  },
]

export const USE_CASES: MarketingEntry[] = [
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
    intro: 'Giving a closed service permission to post as you is a bigger ask than it looks. Postline is MIT licensed and runs on your own machine, so you can read exactly what it does before it gets that permission.',
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
  {
    slug: 'writers',
    nav: 'Writers',
    title: 'Promote the piece once',
    summary: 'Push each essay or newsletter issue to every network, with a link card that renders properly.',
    icon: 'quill-write-02',
    intro: 'Writing the piece is the work. Announcing it on five networks afterwards is not, and it is the part that quietly gets skipped when a deadline is close.',
    sections: [
      { heading: 'Link cards that render', body: 'A link is unfurled into a proper preview card where the network supports it, so the post looks intentional rather than like a bare URL.' },
      { heading: 'Queue the whole sequence', body: 'The announcement, the follow-up quote, and the reminder later in the week all go into the queue when the piece ships, not one at a time afterwards.' },
    ],
    points: [
      'Proper link preview cards',
      'Queue a full promotion sequence at once',
      'Per-network wording without extra drafts',
    ],
  },
]

/** Everything, for sitemap and OG generation. */
export const ALL_ENTRIES: Array<MarketingEntry & { kind: 'feature' | 'use-case', path: string }> = [
  ...FEATURES.map(entry => ({ ...entry, kind: 'feature' as const, path: `/features/${entry.slug}` })),
  ...USE_CASES.map(entry => ({ ...entry, kind: 'use-case' as const, path: `/use-cases/${entry.slug}` })),
]
