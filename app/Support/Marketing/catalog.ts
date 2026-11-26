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
      { heading: 'Publish in one pass', body: 'Pick the accounts you want, write the post, and send it. Each target is published independently, so one network failing never blocks the rest.' },
      { heading: 'Failures stay visible', body: 'A rejected post is recorded against the network that rejected it, with the network\'s own error text. Nothing fails silently. Rate limits and short outages are retried automatically, up to five times, and the queue shows when the next try is; any other failure waits for you.' },
      { heading: 'Several accounts per network', body: 'Connect a personal and a company account on the same network and choose, per post, which of them it goes out from.' },
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
    intro: 'The queue is a plain list of what is going out and when. Drafts, scheduled posts and failures live in the same view, as a list or on a calendar, so there is one place to look before a launch.',
    sections: [
      { heading: 'Your timezone, not the server\'s', body: 'Each post carries the timezone it was written in, so a 9am slot stays 9am regardless of where Postline runs.' },
      { heading: 'Publish now when plans change', body: 'Anything in the queue can be edited or sent immediately without rewriting it. The scheduled entry becomes a published one and keeps its history.' },
      { heading: 'What the queue needs', body: 'A scheduled post fires when Postline is running. On a laptop that means while the app is open; on a small always-on server the queue keeps publishing overnight.' },
    ],
    points: [
      'Drafts, scheduled, publishing and failed in one list',
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
      { heading: 'Counted against the right limit', body: 'The composer counts each variant against the character limit of the network it belongs to, so you find out before publishing and not after.' },
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
    title: 'Plan the launch, not just the post',
    summary: 'Lay a whole launch out across weeks on a calendar, then move the finished plan into the queue in one step.',
    icon: 'flowchart-01',
    intro: 'A launch is a sequence: the teaser, the announcement, the follow-ups, the lesson learned. Campaigns give that sequence a calendar of its own, so you shape the story first and schedule it second.',
    sections: [
      { heading: 'A calendar for the whole arc', body: 'Set the window, drop posts onto days, and drag them when the plan changes. Each post names the channels it is going to, so a gap in the plan is something you can see.' },
      { heading: 'An assistant that drafts the sequence', body: 'Describe the goal, the audience and the tone, and the assistant proposes a sequence you can edit. It works with an OpenAI or Anthropic key, with a local Ollama model, or with the built-in planner when you have no key at all.' },
      { heading: 'Nothing publishes until you say so', body: 'A campaign is a plan until you activate it. Activating moves its posts into the publishing queue, scheduled in the campaign\'s own timezone.' },
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
    intro: 'Posting to six networks means conversations start in six places. The inbox pulls your direct messages into one list, so replying is one habit and not a round of tabs.',
    sections: [
      { heading: 'One list for Bluesky and Mastodon', body: 'Sync pulls the latest conversations from each connected account. Filter by network, open a thread, reply in place, and archive what is done.' },
      { heading: 'Honest about what a network allows', body: 'Bluesky messages need an app password created with direct-message access. X messages are not supported yet, and Instagram messages need Meta\'s app review, which an app you made for yourself does not have. Threads has no public messaging API and LinkedIn limits its own to approved partners. Postline says so in the inbox and does not pretend those messages are there.' },
    ],
    points: [
      'Direct messages from Bluesky and Mastodon',
      'Reply, mark read and archive',
      'Unsupported networks are named, not hidden',
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
      { heading: 'Rules, not searches you rerun', body: 'Give a rule up to twenty keywords and choose whether any or all of them must appear. Postline checks active rules every five minutes while it is running.' },
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
    intro: 'Every network shows you its own numbers in its own app. Postline keeps what it publishes in one place, and syncs likes, reposts and replies for Bluesky posts against the post that earned them. Engagement from the other networks is not synced yet.',
    sections: [
      { heading: 'Counts, attached to your posts', body: 'Likes, reposts and replies are stored per published target, never blended into one total. Today they are synced for Bluesky; the other networks are on the way.' },
      { heading: 'When and where you publish', body: 'See how much went out over the last thirty days, which channels carried it, and which posting windows you actually use.' },
      { heading: 'Batched and rate-aware', body: 'The Bluesky sync runs in batches, and posts deleted upstream are skipped and not reported as errors.' },
    ],
    points: [
      'Bluesky likes, reposts and replies per post',
      'Channel mix and posting windows',
      'History survives an account going away',
    ],
  },
  {
    slug: 'bulk-delete',
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
      { heading: 'Tokens stay where you put them', body: 'Access and refresh tokens are stored encrypted with a key your instance generates. Nobody else has a copy, because there is nobody else.' },
      { heading: 'Your history is a database', body: 'Every post, target and metric is a row in a SQLite file you can query, copy, or export from Settings as one file that another install can import. Dropping a network does not erase what you published there.' },
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
    intro: 'Building in public means the same update has to reach people on whichever network they happen to use. That is repetitive work that scales with the number of networks, not with the value of the post.',
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
    summary: 'Developers are split across Bluesky, X and Mastodon. Reach all of them without choosing a favourite.',
    icon: 'user-group',
    intro: 'Technical audiences fragmented across networks, and no single one of them is where everyone is. Posting to only one means writing off part of your community.',
    sections: [
      { heading: 'Tuned per network', body: 'Mastodon and Bluesky reward a different register than LinkedIn. Per-network variants let one post read naturally on each without maintaining separate drafts.' },
      { heading: 'Hear the replies you were not tagged in', body: 'Listening rules catch a project name or an error message people post without mentioning you, on the networks developers actually use.' },
    ],
    points: [
      'Cover fragmented developer communities',
      'Adjust tone per network',
      'Engagement per post, not a blended average (Bluesky today)',
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
      { heading: 'Software you can inspect', body: 'The whole codebase is readable and MIT licensed. If it does not do what you need, the fix is a pull request and not a support ticket.' },
    ],
    points: [
      'MIT licensed, auditable end to end',
      'Runs on your machine',
      'No vendor holding publish rights',
    ],
  },
  {
    slug: 'agencies',
    nav: 'Agencies',
    title: 'Accounts you actually control',
    summary: 'One person posting for several client accounts, without a vendor holding their tokens.',
    icon: 'building-03',
    intro: 'Scheduling tools price by account and hold the access tokens for clients you are responsible for. Running the tool yourself removes both. Postline has one owner and no team seats, so it suits a person handling several clients, not a team sharing one workspace.',
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
