import type { EmailConfig } from '@stacksjs/types'
import { APEX, FALLBACK_MAIL_DOMAIN, url as siteUrl } from '~/config/domains'
import { env } from '@stacksjs/env'
import { isMarketingSite } from '../app/Support/Marketing/site'

/**
 * **Email Configuration**
 *
 * This configuration defines all of your email options. Because Stacks is fully-typed, you
 * may hover any of the options below and the definitions will be provided. In case you
 * have any questions, feel free to reach out via Discord or GitHub Discussions.
 *
 * WHICH ZONE THE MAIL RECORDS LAND IN
 *
 * `domain` is not just a label — `buddy deploy` publishes this zone's MX, SPF,
 * DKIM and DMARC records from it, and registers the tenant with the shared mail
 * daemon under it.
 *
 * The default sending zone is stacksjs.com. Postline’s web hosts have
 * independent DNS and TLS configuration.
 *
 * NOTE: mail DNS is the one part of the deploy that is single-provider.
 * `reconcileMailDns` in @stacksjs/buddy reads PORKBUN_API_KEY directly, so a
 * mail domain whose zone is in Route53 (as stacksjs.com is) is skipped and its
 * MX/SPF/DKIM/DMARC records have to exist already.
 */

/** The zone mail is sent from: the env override, the apex, then the fallback. */
const MAIL_DOMAIN: string = env.MAIL_DOMAIN || APEX || FALLBACK_MAIL_DOMAIN

/**
 * The host the sender address uses on an install: MAIL_DOMAIN when set, else
 * this instance's own host from APP_URL. A self-hosted install never sends as
 * a Stacks address (#213); with neither set, the sender is at `localhost`,
 * which no real mailer will accept, so nothing goes out from someone else's
 * domain by accident.
 */
function senderDomain(): string {
  if (env.MAIL_DOMAIN) return String(env.MAIL_DOMAIN)
  const host = String(env.APP_URL || '').trim().replace(/^https?:\/\//, '').replace(/[/:].*$/, '')
  return host && !host.endsWith('.localhost') && host !== 'localhost' ? host : 'localhost'
}

/**
 * Give a host an explicit scheme, and leave one that already has it alone.
 * `.localhost` keeps http so a dev machine without a local certificate can
 * still follow the links in a captured email.
 */
function normalizeOrigin(value: string | undefined): string {
  const host = String(value ?? '').trim().replace(/\/+$/, '')
  if (!host)
    return ''
  if (/^https?:\/\//.test(host))
    return host

  return `${host.endsWith('.localhost') ? 'http' : 'https'}://${host}`
}

export default {
  from: {
    name: env.MAIL_FROM_NAME || 'Postline',
    address: env.MAIL_FROM_ADDRESS || `no-reply@${senderDomain()}`,
  },

  domain: MAIL_DOMAIN,

  /**
   * Mailbox users for IMAP/SMTP access. None: Postline sends mail through the
   * mailer you configure (MAIL_MAILER) and hosts no inboxes. The three that
   * were here were the framework authors' own, inherited by every install (#213).
   */
  mailboxes: [],

  /**
   * The origin templated into mail links (confirmation, unsubscribe).
   *
   * `APP_URL` can be a bare host such as `postline.theopentimes.org`, while this
   * field is concatenated with
   * a path to build a link. Taking it raw produced `<host>/confirm/…`,
   * which a mail client renders as relative text rather than a link. The
   * scaffold's fallback had a scheme and the env value did not, so the bug only
   * appeared once APP_URL was set, which is to say only in production.
   */
  url: normalizeOrigin(env.APP_URL) || siteUrl,
  charset: 'UTF-8',

  server: {
    // The bundled mail server is off: an install sends through its own mailer.
    enabled: false,
    scan: true, // scans for spam and viruses
    subdomain: 'mail', // mail.<MAIL_DOMAIN>

    /**
     * Server mode:
     * - 'server': Full-featured Zig mail server with IMAP, POP3, CalDAV, etc. (default)
     * - 'serverless': Lightweight TypeScript/Bun server (~$3/month)
     */
    mode: (env.MAIL_SERVER_MODE || 'server') as 'serverless' | 'server',

    /**
     * Report-only, deliberately.
     *
     * Postline has no sending history of its own to enforce against. The
     * framework default is `p=quarantine`, which is right for an established
     * sender and wrong for a new one: a single alignment problem starts sending
     * account mail to the spam folder. Read the aggregate reports first, then
     * tighten to quarantine.
     */
    dmarc: {
      policy: 'none',
      reportTo: `chris@${MAIL_DOMAIN}`,
    },

    storage: {
      retentionDays: 90,
      archiveAfterDays: 30,
    },

    // EC2 instance configuration for IMAP/SMTP server
    instance: {
      // For 'serverless' mode: t4g.nano ARM64 (~$3/month) is sufficient
      // For 'server' mode: t3.small x86_64 required for Zig binary
      type: 't4g.nano',
      spot: false, // set to true for ~50% cost savings (can be interrupted)
      diskSize: 8, // GB
      // keyPair: 'my-key-pair', // optional SSH access
    },

    ports: {
      smtp: 25, // Standard SMTP
      smtps: 465, // SMTP over TLS
      submission: 587, // SMTP with STARTTLS
      imap: 143, // IMAP
      imaps: 993, // IMAP over TLS
      pop3: 110, // POP3
      pop3s: 995, // POP3 over TLS
    },

    // Features (only available in 'server' mode)
    features: {
      imap: true,
      pop3: true,
      webmail: false, // future
      calDAV: false, // calendar sync
      cardDAV: false, // contacts sync
      activeSync: false, // Exchange ActiveSync
    },

    /**
     * Automatic email categorization (Gmail-style folders)
     * Emails are automatically sorted into Social, Forums, Updates, Promotions folders
     * based on sender patterns. You can customize the patterns below.
     */
    categorization: {
      enabled: true,

      // Social networks - Facebook, Twitter, LinkedIn, etc.
      social: {
        domains: [
          'facebookmail.com', 'facebook.com', 'fb.com',
          'twitter.com', 'x.com',
          'linkedin.com', 'linkedinmail.com',
          'instagram.com',
          'pinterest.com',
          'snapchat.com',
          'tiktok.com',
          'reddit.com', 'redditmail.com',
          'tumblr.com',
          'whatsapp.com',
          'telegram.org',
          'discord.com', 'discordapp.com',
          'slack.com',
          'meetup.com',
          'nextdoor.com',
          'quora.com',
          'medium.com',
          'mastodon.social',
          'threads.net',
          'bluesky.social',
        ],
        substrings: [
          'notification@', 'notifications@',
          'noreply@', 'no-reply@',
          '@social.', '@notifications.',
          'updates@', 'info@',
        ],
        headers: {
          'x-mailer': ['facebook', 'twitter', 'linkedin'],
        },
      },

      // Forums & mailing lists - Google Groups, Discourse, etc.
      forums: {
        domains: [
          'googlegroups.com', 'groups.google.com',
          'discourse.org',
          'stackoverflow.com', 'stackexchange.com',
          'freelancer.com',
          'upwork.com',
          'mailman.org',
          'listserv.net',
          'sympa.org',
          'yahoogroups.com',
          'topica.com',
          'gnu.org',
          'sourceforge.net',
          'launchpad.net',
        ],
        substrings: [
          '-list@', '-users@', '-dev@', '-announce@',
          'forum@', 'discuss@', 'community@',
          '@lists.', '@mailman.', '@groups.',
          'reply+', // GitHub discussion replies
        ],
        headers: {
          'list-unsubscribe': [''],
          'list-id': [''],
          'precedence': ['list', 'bulk'],
          'x-mailing-list': [''],
        },
      },

      // Updates & transactional - GitHub, Stripe, shipping, etc.
      updates: {
        domains: [
          'github.com', 'gitlab.com', 'bitbucket.org',
          'stripe.com', 'paypal.com', 'square.com', 'venmo.com',
          'ups.com', 'fedex.com', 'usps.com', 'dhl.com',
          'amazon.com', 'amazonses.com',
          'google.com', 'accounts.google.com',
          'apple.com', 'id.apple.com',
          'microsoft.com', 'live.com', 'outlook.com',
          'dropbox.com', 'box.com',
          'atlassian.com', 'jira.com', 'trello.com',
          'notion.so', 'airtable.com', 'asana.com',
          'vercel.com', 'netlify.com', 'heroku.com',
          'cloudflare.com', 'digitalocean.com',
          'twilio.com', 'sendgrid.com',
          'intercom.io', 'zendesk.com', 'freshdesk.com',
          'calendly.com', 'cal.com',
          'zoom.us', 'zoom.com',
          'doordash.com', 'ubereats.com', 'grubhub.com',
          'airbnb.com', 'booking.com', 'expedia.com',
          'uber.com', 'lyft.com',
          'netflix.com', 'spotify.com', 'hulu.com',
        ],
        substrings: [
          'alert@', 'alerts@',
          'notification@', 'notifications@',
          'noreply@', 'no-reply@',
          'security@', 'support@',
          'confirm@', 'confirmation@',
          'receipt@', 'invoice@', 'billing@',
          'shipping@', 'delivery@', 'order@', 'orders@',
          'account@', 'password@',
          'verify@', 'verification@',
        ],
        headers: {
          'auto-submitted': ['auto-generated', 'auto-replied'],
          'x-auto-response-suppress': [''],
        },
      },

      // Promotions & marketing - newsletters, sales, etc.
      promotions: {
        domains: [
          'mailchimp.com', 'mail.mailchimp.com',
          'sendgrid.net', 'sendgrid.com',
          'constantcontact.com',
          'mailerlite.com',
          'hubspot.com', 'hubspotmail.com',
          'klaviyo.com',
          'convertkit.com',
          'drip.com',
          'getresponse.com',
          'aweber.com',
          'campaignmonitor.com',
          'sendinblue.com', 'brevo.com',
          'activecampaign.com',
          'emarsys.net',
          'salesforce.com', 'exacttarget.com',
          'amazon.com', 'amazonsellerservices.com',
          'walmart.com',
          'target.com',
          'bestbuy.com',
          'ebay.com',
          'etsy.com',
          'shopify.com',
          'wish.com',
          'aliexpress.com',
          'wayfair.com',
          'homedepot.com',
          'lowes.com',
          'kohls.com',
          'macys.com',
          'nordstrom.com',
          'gap.com',
          'nike.com',
          'adidas.com',
          'lululemon.com',
          'uniqlo.com',
          'zara.com',
          'hm.com',
          'sephora.com',
          'ulta.com',
          'groupon.com',
          'retailmenot.com',
        ],
        substrings: [
          'promo@', 'promotions@',
          'marketing@', 'newsletter@', 'news@',
          'deals@', 'offers@', 'sale@', 'sales@',
          'shop@', 'store@',
          'rewards@', 'loyalty@',
          'unsubscribe', // common in promotional emails
          'campaign', 'blast@',
        ],
        headers: {
          'x-campaign': [''],
          'x-mailchimp-id': [''],
          'x-mc-user': [''],
          'x-sg-eid': [''], // SendGrid
          'x-ses-outgoing': [''], // AWS SES promotional
        },
      },
    },
  },

  notifications: {
    newEmail: true,
    bounces: true,
    complaints: true,
  },

  // The hosted-plan waitlist confirms each address by email before it joins
  // (resources/emails/subscription-confirm.stx). Read when the first signup
  // creates the default list.
  // The signup and its confirmation link exist only on the marketing site; an
  // install has no waitlist (#222). Unsubscribe links always work.
  newsletter: { doubleOptIn: true, signup: isMarketingSite() },

  default: (env.MAIL_MAILER || env.MAIL_DRIVER || 'log') as 'ses' | 'sendgrid' | 'mailgun' | 'mailtrap' | 'smtp' | 'log',
} satisfies EmailConfig
