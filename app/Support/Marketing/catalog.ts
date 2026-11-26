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
    summary: 'Write once and publish to Bluesky, X, LinkedIn, Instagram, Threads and Mastodon in a single action.',
    icon: 'share-08',
    intro: 'The same update has to reach people on whichever network they use. Postline takes one draft, checks it against each network, and publishes to all of them at once, to as many accounts on each as you have connected.',
    sections: [
      { heading: 'Publish in one pass', body: 'Pick the accounts you want, write the post, and send it. Postline sends to each selected account independently, so the other accounts can still publish if one fails.' },
      { heading: 'Failures stay visible', body: 'A rejected post is recorded against the network that rejected it, with the network\'s own error text. Nothing fails silently. Rate limits and short outages are retried automatically, up to five times, and the queue shows when the next try is; any other failure waits for you.' },
      { heading: 'Several accounts per network', body: 'Connect a personal and a company account on the same network and choose, per post, which of them it goes out from.' },
    ],
    points: [
      'Six networks from one composer',
      'Publishing status for each account',
      'Threads chain automatically where the network supports replies',
    ],
  },
  {
    slug: 'scheduling',
    nav: 'Scheduling',
    title: 'Queue it now, publish it later',
    summary: 'Schedule posts in your time zone, or publish them right away.',
    icon: 'calendar-03',
    intro: 'The queue is a plain list of what is going out and when. Drafts, scheduled posts and failures live in the same view, as a list or on a calendar, so there is one place to look before a launch.',
    sections: [
      { heading: 'Set your time zone', body: 'The queue uses the time zone you choose in Settings. A 9 a.m. slot follows that time zone wherever Postline runs.' },
      { heading: 'Publish now when plans change', body: 'Anything in the queue can be edited or sent immediately without rewriting it. The scheduled entry becomes a published one and keeps its history.' },
      { heading: 'What the queue needs', body: 'A scheduled post fires when Postline is running. On a laptop that means while the app is open; on a small always-on server the queue keeps publishing overnight.' },
    ],
    points: [
      'Scheduled, Drafts, Published, and Needs attention tabs',
      'List and calendar views',
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
      { heading: 'Counted against the right limit', body: 'The composer checks each variant against its network’s limit before publishing.' },
    ],
    points: [
      'One shared body, optional per-network overrides',
      'Live character counts per network',
      'No duplicate drafts to keep in sync',
    ],
  },
  {
    slug: 'campaigns',
    nav: 'Campaigns',
    title: 'Plan a launch across weeks',
    summary: 'Lay a whole launch out across weeks on a calendar, then move the finished plan into the queue in one step.',
    icon: 'flowchart-01',
    intro: 'A launch is a sequence: the teaser, the announcement, the follow-ups, the lesson learned. Campaigns give that sequence a calendar of its own, so you shape the story first and schedule it second.',
    sections: [
      { heading: 'A calendar for the whole arc', body: 'Set the window, drop posts onto days, and drag them when the plan changes. Each post shows its networks so you can spot gaps in the plan.' },
      { heading: 'An assistant that drafts the sequence', body: 'Describe the goal, the audience and the tone, and the assistant proposes a sequence you can edit. It works with an OpenAI or Anthropic key, with a local Ollama model, or with the built-in planner when you have no key at all.' },
      { heading: 'Activate when the plan is ready', body: 'A campaign is a plan until you activate it. Activating moves its posts into the publishing queue, scheduled in the campaign\'s own timezone.' },
    ],
    points: [
      'Calendar and list views of a launch',
      'AI-drafted sequences you edit before anything is queued',
      'One step from finished plan to scheduled posts',
    ],
  },
  {
    slug: 'inbox',
    nav: 'Inbox',
    title: 'Answer everyone from one inbox',
    summary: 'Read and reply to direct messages from Bluesky and Mastodon without switching apps.',
    icon: 'message-01',
    intro: 'See direct messages from Bluesky and Mastodon together. Open a conversation, reply, or archive it from the same inbox.',
    sections: [
      { heading: 'One list for Bluesky and Mastodon', body: 'Sync pulls the latest conversations from each connected account. Filter by network, open a thread, reply in place, and archive what is done.' },
      { heading: 'Bluesky message permissions', body: 'To read and reply to Bluesky direct messages, connect with an app password that includes direct-message access.' },
    ],
    points: [
      'Direct messages from Bluesky and Mastodon',
      'Reply, mark read and archive',
      'Filter by network and account',
    ],
  },
  {
    slug: 'listening',
    nav: 'Listening',
    title: 'Know when people talk about you',
    summary: 'Watch brand, product and competitor keywords across Bluesky, X and Mastodon, and read the mentions in one place.',
    icon: 'radar-02',
    intro: 'Most mentions never tag you. A listening rule is a set of keywords and the networks to watch them on, checked on a schedule, with every match collected where you will read it.',
    sections: [
      { heading: 'Automatic keyword checks', body: 'Give a rule up to twenty keywords and choose whether any or all of them must appear. Postline checks active rules every five minutes while it is running.' },
      { heading: 'A mention inbox', body: 'Matches arrive in one list, unread until you open them, filterable by rule. Scan now when you do not want to wait for the next check.' },
    ],
    points: [
      'Keyword rules across three networks',
      'Checked automatically every five minutes',
      'Unread mentions in one list',
    ],
  },
  {
    slug: 'analytics',
    nav: 'Analytics',
    title: 'What actually landed',
    summary: 'Publishing activity across every network, and engagement for Bluesky posts, stored against the posts that earned it.',
    icon: 'chart-line-data-01',
    intro: 'Compare publishing activity across the networks you use. Postline syncs likes, reposts, and replies for Bluesky and shows the interactions earned by measured posts.',
    sections: [
      { heading: 'Counts, attached to your posts', body: 'Postline stores interactions with each measured Bluesky post. Recommendations require enough measured posts and a clear leader.' },
      { heading: 'When and where you publish', body: 'See how much went out over the last thirty days, which networks carried it, and which posting windows you use.' },
      { heading: 'Batched and rate-aware', body: 'The Bluesky sync runs in batches and skips posts that have been deleted.' },
    ],
    points: [
      'Bluesky likes, reposts and replies per post',
      'Publishing by network and posting window',
      'History survives an account going away',
    ],
  },
  {
    slug: 'cleanup',
    nav: 'Cleanup',
    title: 'Take it all back down',
    summary: 'Delete old posts automatically after a set number of days, or clear a whole account in one run, with a preview first.',
    icon: 'delete-02',
    intro: 'Leaving a network, or clearing an old account, normally means deleting posts one at a time. Postline removes them in bulk, on a schedule if you want, and makes you look at exactly what will go before anything does.',
    sections: [
      { heading: 'Preview before anything is deleted', body: 'A dry run reports the exact count per network and a sample of what matched. The delete button stays locked until you have previewed the selection you are about to act on.' },
      { heading: 'Automatic deletion', body: 'Turn on a retention period and posts older than it are deleted daily, on the networks you choose. Limit it to posts Postline published, or include everything on the account.' },
      { heading: 'Scoped to what a network allows', body: 'Networks that cannot delete, or cannot list an account\'s history, are reported as skipped with the reason.' },
    ],
    points: [
      'Dry-run preview with per-network counts',
      'Retention period with daily cleanup',
      'Every run recorded in an audit log',
    ],
  },
  {
    slug: 'own-your-keys',
    nav: 'Own your keys',
    title: 'Nobody else can post as you',
    summary: 'Your posts, your history and your access tokens live in a database you run. There is no vendor in the middle.',
    icon: 'key-01',
    intro: 'Every hosted scheduler holds the one thing that matters: permission to post as you, on every account you connected. Postline is the same kind of tool with that permission kept on hardware you control.',
    sections: [
      { heading: 'Tokens stay where you put them', body: 'Postline encrypts access and refresh tokens with a key your installation generates. The connected network receives the credential when Postline uses its API.' },
      { heading: 'Your history is a database', body: 'Postline stores posts, publishing results, and metrics in SQLite. Export your workspace from Settings to move that history to another install.' },
      { heading: 'Run it wherever suits you', body: 'It runs on Bun with a SQLite file: on a Mac as one app, or on a small server when you want the queue publishing while the laptop is shut. Instagram and Threads fetch images from a public address, so on a laptop they need the temporary image links switch in Settings.' },
    ],
    points: [
      'Tokens encrypted with a key only you hold',
      'Posts and metrics in your own database',
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
    intro: 'Write an update once and reach the people following your work across networks.',
    sections: [
      { heading: 'Launch days stop being copy and paste', body: 'Plan the launch as a campaign, write each post once, and activate it. Follow-ups through the week are already in the queue.' },
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
    summary: 'Share updates with developer communities on Bluesky, X, and Mastodon.',
    icon: 'user-group',
    intro: 'Developer communities gather on different networks. Write for each community in the language its audience uses.',
    sections: [
      { heading: 'Tuned per network', body: 'Mastodon and Bluesky reward a different register than LinkedIn. Per-network variants let one post read naturally on each without maintaining separate drafts.' },
      { heading: 'Hear the replies you were not tagged in', body: 'Listening rules catch a project name or an error message people post without mentioning you, on the networks developers actually use.' },
    ],
    points: [
      'Cover fragmented developer communities',
      'Adjust tone per network',
      'Per-post engagement on Bluesky',
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
      { heading: 'Software you can inspect', body: 'The codebase is MIT licensed. Inspect it or submit a pull request to change how it works.' },
    ],
    points: [
      'MIT licensed, auditable end to end',
      'Runs on your machine',
      'Account credentials stay with your workspace',
    ],
  },
  {
    slug: 'agencies',
    nav: 'Agencies',
    title: 'Accounts you actually control',
    summary: 'One person posting for several client accounts, without a vendor holding their tokens.',
    icon: 'building-03',
    intro: 'One workspace owner can publish for several clients. Connect each client account and choose which ones receive a post.',
    sections: [
      { heading: 'No per-account pricing', body: 'Cost does not change with the number of accounts connected, because there is no vendor in the middle metering it.' },
      { heading: 'Clean handover', body: 'When an engagement ends, disconnect the account to delete its tokens from Postline, have the client remove the app in that network\'s settings, and give them an export of the workspace with the posting history.' },
    ],
    points: [
      'Cost does not scale with accounts',
      'Client tokens stay on hardware you control',
      'Bulk cleanup for a clean account handover',
    ],
  },
  {
    slug: 'publications',
    nav: 'Publications',
    title: 'Distribution for a publication',
    summary: 'Announce every story on every network. The Open Times, an independent publishing platform, uses Postline for exactly this.',
    icon: 'news',
    intro: 'Publishing a story is half the job; the other half is telling people it exists, on six networks, in six registers. Postline is the distribution desk: the story goes out once and is announced everywhere.',
    sections: [
      { heading: 'Built for a real newsroom', body: 'The Open Times is an open-source publication platform for writers who want to own their list. Its syndication runs on the same engine as Postline.' },
      { heading: 'Announce, then follow up', body: 'Queue the announcement for the moment a story goes live, and the pull quotes and follow-ups for the days after it.' },
    ],
    points: [
      'One announcement, every network',
      'Follow-ups queued with the story',
      'Used in production by The Open Times',
    ],
  },
]

/** Everything, for sitemap and OG generation. */
export const ALL_ENTRIES: Array<MarketingEntry & { kind: 'feature' | 'use-case', path: string }> = [
  ...FEATURES.map(entry => ({ ...entry, kind: 'feature' as const, path: `/features/${entry.slug}` })),
  ...USE_CASES.map(entry => ({ ...entry, kind: 'use-case' as const, path: `/use-cases/${entry.slug}` })),
]
