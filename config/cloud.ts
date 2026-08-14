import type { CloudConfig } from '@stacksjs/types'
import type { CloudConfig as TsCloudConfig } from '@stacksjs/ts-cloud'
import { servers } from '~/cloud/servers'
import * as domains from '~/config/domains'
import { env } from '@stacksjs/env'

/**
 * Stacks Cloud Configuration
 *
 * This file defines your cloud infrastructure configuration for Stacks.
 * Supports both server mode (Forge-style) and serverless mode (Vapor-style).
 *
 * Environment variables:
 * - CLOUD_ENV: Set the active environment (production, staging, development)
 * - NODE_ENV: Fallback for CLOUD_ENV
 *
 * @see https://github.com/stacksjs/ts-cloud
 */

/**
 * Persistent data outside the release tree.
 *
 * ts-cloud deploys into `releases/<sha>` and flips a `current` symlink, so a
 * database stored under the app directory belongs to exactly one release: the
 * next deploy lands in a new tree, `buddy migrate` creates an empty file there,
 * and every account, queued post and subscriber from the previous release is
 * gone — with the old copy left behind, so nothing looks like it failed.
 *
 * Both sites point at this one absolute path. `sharedPaths` would also survive
 * deploys, but only per-site: `main` and `api` deploy to separate directories
 * and would each get their own copy of a database they are supposed to share.
 *
 * REBRAND NOTE: this path used to be `/var/lib/postline/postline.sqlite`. It is
 * outside the release tree precisely so a deploy cannot replace it — which also
 * means a deploy cannot MOVE it. Any box that already ran the old name needs
 * the file relocated once, by hand, before the next deploy:
 *
 *   mv /var/lib/postline /var/lib/opentimes
 *   mv /var/lib/opentimes/postline.sqlite /var/lib/opentimes/opentimes.sqlite
 *
 * Skipping that does not error: `buddy migrate` would create an empty database
 * at the new path and the app would come up looking freshly installed.
 */
const DATA_DIR = '/var/lib/opentimes'
const DB_DATABASE_PATH = `${DATA_DIR}/opentimes.sqlite`

/**
 * The release tarball is packed from the working tree, not from git — so
 * gitignoring the local database stops it being committed but not shipped. It
 * has been travelling to the server in every release: developer data, uploaded
 * media rows and all, landing next to production's own copy.
 */
const SQLITE_EXCLUDES = ['*.sqlite', '*.sqlite-shm', '*.sqlite-wal']

/**
 * The encrypted env file, and the key that would open it, both stay home.
 *
 * `.env.production` was shipping in every release, where nothing can read it:
 * `.env.keys` is not on the server and no `DOTENV_PRIVATE_KEY_PRODUCTION` is set
 * for the deployed processes. The env layer loads it anyway, fails to decrypt
 * all 49 values, and warns that "defaults apply" — which is untrue and sent this
 * investigation down a long detour. The deploy has already decrypted those
 * values and written them, in plaintext, to the shared `.env` that loads
 * immediately after, so every one of them resolves correctly either way.
 *
 * Excluding it removes the false warning and leaves one fewer copy of the
 * secrets on the box. `.env.keys` is listed too — it does not appear to ship
 * today, but the tarball is packed from the working tree where it does exist,
 * and a private key is not something to leave to inference.
 */
const ENV_EXCLUDES = ['.env.production', '.env.keys']

const RELEASE_EXCLUDES = [...SQLITE_EXCLUDES, ...ENV_EXCLUDES]

// ts-cloud configuration for deployment
export const tsCloud: TsCloudConfig = {
  /**
   * Project configuration
   */
  project: {
    name: 'opentimes',
    slug: 'opentimes',
    region: 'us-east-1',
  },

  stateDir: 'storage/cloud',

  /**
   * The Open Times is a tenant of the shared `stacks` Hetzner box, not the owner of
   * its own server.
   *
   * `attachTo` is what makes that true rather than aspirational: it stops this
   * project from provisioning or reconciling the box's infrastructure. The
   * host also serves stacksjs.com, mail, PostgreSQL and ten other tenants, and
   * its Hetzner firewall is reconciled from whichever config claims ownership
   * — so deploying without this would silently rewrite the shared firewall
   * from The Open Times' (much smaller) port list and drop public mail.
   */
  cloud: {
    provider: 'hetzner',
    attachTo: 'stacks',
  },

  /**
   * Deployment Mode
   *
   * - 'server': Traditional EC2-based deployment (Forge-style)
   * - 'serverless': Container + static site deployment (Vapor-style)
   */
  mode: 'server',

  /**
   * Environment configurations
   * Each environment can have its own settings
   *
   * Note: Deployment mode is automatically determined by your infrastructure configuration.
   * Simply define the resources you need below (functions, servers, storage, etc.) and
   * ts-cloud will deploy them accordingly. You can mix and match any resources.
   */
  environments: {
    production: {
      type: 'production',
      region: 'us-east-1',
      variables: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
      },
    },
    staging: {
      type: 'staging',
      region: 'us-east-1',
      variables: {
        NODE_ENV: 'staging',
        LOG_LEVEL: 'debug',
      },
    },
    development: {
      type: 'development',
      region: 'us-east-1',
      variables: {
        NODE_ENV: 'development',
        LOG_LEVEL: 'debug',
      },
    },
  },

  /**
   * Infrastructure configuration
   * Define your cloud resources here
   */
  infrastructure: {
    /**
     * Compute Configuration
     *
     * For mode: 'server'
     * Defines the EC2 instances running your Stacks/Bun application.
     * When instances > 1, load balancer is automatically enabled.
     *
     * For mode: 'serverless'
     * These settings are not used. See 'containers' configuration instead.
     *
     * @example Single instance (development/staging)
     * compute: { instances: 1, size: 'micro' }
     *
     * @example Multiple instances with auto-scaling (production)
     * compute: {
     *   instances: 3,
     *   size: 'small',
     *   autoScaling: { min: 2, max: 10, scaleUpThreshold: 70 },
     * }
     *
     * @example Mixed instance fleet for cost optimization
     * compute: {
     *   instances: 3,
     *   fleet: [
     *     { size: 'small', weight: 1 },
     *     { size: 'medium', weight: 2 },
     *     { size: 'small', weight: 1, spot: true },
     *   ],
     *   spotConfig: {
     *     baseCapacity: 1,           // Always keep 1 on-demand
     *     onDemandPercentage: 50,    // 50% on-demand, 50% spot
     *     strategy: 'capacity-optimized',
     *   },
     * }
     */
    compute: {
      instances: 1,
      size: 'small', // Provider-agnostic: 'nano', 'micro', 'small', 'medium', 'large', 'xlarge', '2xlarge' (small = 2GB RAM, needed for bun install)
      disk: {
        size: 20,
        type: 'ssd', // Provider-agnostic: 'standard', 'ssd', 'premium'
        encrypted: true,
      },
      // Uncomment for auto-scaling:
      // autoScaling: {
      //   min: 1,
      //   max: 5,
      //   scaleUpThreshold: 70,
      //   scaleDownThreshold: 30,
      // },
      // Uncomment for mixed instance fleet:
      // fleet: [
      //   { size: 'micro', weight: 1 },
      //   { size: 'small', weight: 2 },
      //   { size: 'micro', weight: 1, spot: true },
      // ],
      // spotConfig: {
      //   baseCapacity: 1,
      //   onDemandPercentage: 50,
      //   strategy: 'capacity-optimized',
      // },
    },

    /**
     * Server Definitions
     * EC2 instances for server mode deployment
     */
    servers: {
      app: servers.app,
      // app2: servers.app2,
      // web: servers.web,
      // cache: servers.cache,
    } as NonNullable<TsCloudConfig['infrastructure']>['servers'],

    /**
     * Jump Box / Bastion Host
     *
     * Provides SSH access to your private cloud resources.
     * Set to `true` for a default t3.micro jump box, or configure options.
     *
     * Connect via: buddy cloud:ssh
     * Or via SSM: aws ssm start-session --target <instance-id>
     */
    // jumpBox: true,
    // jumpBox: {
    //   enabled: true,
    //   size: 'micro',
    //   keyName: 'stacks-production',
    //   allowedCidrs: ['0.0.0.0/0'],
    //   databaseTools: true,
    //   mountEfs: true,
    // },

    /**
     * Container Configuration (for serverless mode only)
     *
     * Defines ECS Fargate containers running your Bun API.
     * Only used when mode: 'serverless'.
     *
     * @example Basic API container
     * containers: {
     *   api: {
     *     cpu: 256,    // 0.25 vCPU
     *     memory: 512, // 512 MB
     *     port: 3000,
     *     healthCheck: '/health',
     *   }
     * }
     *
     * @example Production API with auto-scaling
     * containers: {
     *   api: {
     *     cpu: 512,
     *     memory: 1024,
     *     port: 3000,
     *     desiredCount: 2,
     *     autoScaling: {
     *       min: 2,
     *       max: 10,
     *       targetCpuUtilization: 70,
     *     },
     *   }
     * }
     */
    containers: {
      api: {
        cpu: 512, // 256, 512, 1024, 2048, 4096
        memory: 1024, // Must be compatible with CPU (512 MB - 16 GB)
        port: 3000,
        healthCheck: '/health',
        desiredCount: 2,
        autoScaling: {
          min: 1,
          max: 10,
          targetCpuUtilization: 70,
          targetMemoryUtilization: 80,
        },
      },
    },

    /**
     * Load Balancer Configuration
     *
     * Controls whether to use an Application Load Balancer (ALB) for traffic distribution.
     * Automatically enabled when compute.instances > 1.
     *
     * Benefits of ALB:
     * - SSL termination with ACM certificates (free)
     * - Health checks and automatic failover
     * - HTTP to HTTPS redirect
     * - Multiple target support
     *
     * When to disable:
     * - Cost optimization (ALB costs ~$16/month minimum)
     * - Simple single-instance deployments
     * - Using Let's Encrypt for SSL instead of ACM
     */
    loadBalancer: {
      enabled: true,
      type: 'application',
      healthCheck: {
        path: '/health',
        interval: 30,
        healthyThreshold: 2,
        unhealthyThreshold: 5,
      },
    },

    /**
     * SSL/TLS Configuration
     *
     * Supports two providers:
     * - 'acm': AWS Certificate Manager (free, requires ALB or CloudFront)
     * - 'letsencrypt': Free certificates (works without ALB, runs on EC2)
     *
     * When loadBalancer.enabled = true:
     *   - Uses ACM by default (recommended)
     *   - Certificates are automatically requested and validated via DNS
     *   - HTTP to HTTPS redirect handled by ALB
     *
     * When loadBalancer.enabled = false:
     *   - Uses Let's Encrypt by default
     *   - Certificates are obtained and renewed automatically on EC2
     *   - Requires port 80 for HTTP-01 challenge or DNS for DNS-01
     */
    ssl: {
      enabled: true,
      provider: 'acm', // 'acm' | 'letsencrypt'
      /**
       * Every host we answer on needs a certificate — including the ones that
       * only redirect, because a browser validates TLS *before* it ever sees
       * the 301. This used to read `env.SSL_DOMAINS?.split(',') ||
       * ['stacksjs.com', 'www.stacksjs.com']`: the env var was never set, so it
       * requested a certificate for a domain belonging to a different tenant
       * and none at all for this app's own.
       */
      domains: [...domains.all],
      redirectHttp: true,
      // Let's Encrypt configuration (used when provider: 'letsencrypt' or loadBalancer.enabled: false)
      letsEncrypt: {
        email: env.LETSENCRYPT_EMAIL || `admin@${domains.APEX}`,
        staging: false, // Set to true for testing
        autoRenew: true,
      },
    },

    /**
     * DNS Configuration
     *
     * `domain` is the canonical host, so the zone this resolves against follows
     * `DOMAIN_MODE` with everything else. The Route53 hosted zone only covers
     * stacksjs.com — the apex and the short domains are served by Porkbun,
     * which ts-cloud discovers from the environment (see config/dns.ts).
     */
    dns: {
      domain: domains.canonical,
      hostedZoneId: env.AWS_HOSTED_ZONE_ID || 'Z01455702Q7952O6RCY37', // Route53 hosted zone ID
    },

    /**
     * Storage Configuration
     * S3 buckets for frontend, assets, uploads, etc.
     *
     * Mirrors the old CDK StorageStack defaults:
     * - public: website-hosting bucket for frontend (index.html)
     * - private: locked-down bucket for uploads, secrets, etc.
     * - docs: website-hosting bucket for documentation (conditional)
     * - logs: access-log bucket (retained on delete for audit)
     */
    storage: {
      'public': {
        public: true,
        encryption: true,
        versioning: true,
        website: {
          indexDocument: 'index.html',
          errorDocument: 'index.html',
        },
      },
      'private': {
        encryption: true,
        versioning: true,
      },
      'docs': {
        public: true,
        encryption: true,
        versioning: true,
        path: '/docs',
        pathRewriteStyle: 'flat',
        website: {
          indexDocument: 'index.html',
          errorDocument: '404.html',
        },
      },
      'blog': {
        public: true,
        encryption: true,
        versioning: true,
        path: '/blog',
        website: {
          indexDocument: 'index.html',
          errorDocument: '404.html',
        },
      },
      'logs': {
        encryption: true,
        versioning: false,
      },
      'backups': {
        encryption: true,
        versioning: true,
      },
      'email': {
        public: false,
        encryption: true,
        versioning: false,
      },
    },

    /**
     * Functions Configuration (optional)
     * Lambda functions for specific serverless workloads
     *
     * Note: Stacks uses Bun-based routing (./routes) for APIs, not Lambda functions.
     * Only add functions here for specific use cases like:
     * - Background job processing
     * - Event-driven tasks
     * - Image processing
     * - Scheduled tasks
     */
    functions: {
      // Example background worker (optional)
      // 'background-worker': {
      //   handler: 'worker.handler',
      //   runtime: 'nodejs20.x',
      //   timeout: 300,
      //   memorySize: 1024,
      // },
    },

    /**
     * Queue Configuration (SQS)
     * Background job processing, event-driven tasks, and scheduled work.
     *
     * Jobs defined in app/Jobs/*.ts are auto-discovered at deploy time
     * and scheduled via EventBridge rules targeting these queues.
     */
    queues: {
      jobs: {
        visibilityTimeout: 120,
        deadLetterQueue: true,
        maxReceiveCount: 3,
      },
      // Uncomment for ordered processing:
      // orders: {
      //   fifo: true,
      //   contentBasedDeduplication: true,
      // },
    },

    /**
     * Database Configuration (optional)
     */
    databases: {
      // Uncomment to add a database
      // 'main': {
      //   engine: 'postgres',
      //   instanceClass: 'db.t3.micro',
      //   storage: 20,
      //   username: 'admin',
      //   password: 'changeme123', // Use AWS Secrets Manager in production
      // },
    },

    /**
     * CDN Configuration
     * CloudFront distribution for global content delivery
     */
    cdn: {
      // Uncomment to enable CloudFront CDN
      // 'frontend': {
      //   origin: 'stacks-production-frontend.s3.us-east-1.amazonaws.com',
      //   customDomain: 'cdn.stacks-js.org',
      // },
    },

    /**
     * Redirects Configuration
     * Domain-level and path-level URL redirects.
     *
     * Domain redirects create S3 redirect buckets.
     * Path redirects create CloudFront Functions.
     */
    // redirects: {
    //   // Redirect these domains to your primary domain
    //   // domains: ['www.stacksjs.com', 'stacks.dev'],
    //   // target: 'stacksjs.com',
    //
    //   // Path-level redirects (source -> target)
    //   // paths: {
    //   //   '/old-page': '/new-page',
    //   //   '/blog/old-post': '/blog/new-post',
    //   // },
    // },

    /**
     * Cache Configuration (ElastiCache)
     * Redis or Memcached for in-memory caching
     */
    // Cache temporarily disabled for initial deployment - enable after stack is stable
    // cache: {
    //   type: 'redis',
    //   nodeType: 'cache.t3.micro',
    //   redis: {
    //     engineVersion: '7.1',
    //     numCacheNodes: 2,
    //     automaticFailoverEnabled: true,
    //     snapshotRetentionLimit: 7,
    //   },
    // },

    /**
     * Email Configuration (SES)
     * Amazon SES for transactional email sending
     *
     * Domain is auto-detected from dns.domain if not specified.
     * DNS records (SPF, DKIM, DMARC) are auto-created when hostedZoneId is available.
     *
     * Note: 'email' is not a valid property on InfrastructureConfig.
     * Uncomment and move to a supported config section when the type supports it.
     */
    // email: {
    //   domain: 'stacksjs.com',
    //   configurationSet: true,
    //   enableDkim: true,
    //   server: {
    //     enabled: true,
    //   },
    // },

    /**
     * Search Configuration (OpenSearch)
     * Full-text search engine powered by OpenSearch
     */
    // search: {
    //   instanceType: 't3.small.search',
    //   instanceCount: 1,
    //   volumeSize: 10,
    //   volumeType: 'gp3',
    //   encryption: {
    //     atRest: true,
    //     nodeToNode: true,
    //   },
    //   autoTune: true,
    // },

    /**
     * File System Configuration (EFS)
     * Elastic File System for shared storage across instances
     */
    // fileSystem: {
    //   shared: {
    //     encrypted: true,
    //     performanceMode: 'generalPurpose',
    //     throughputMode: 'bursting',
    //   },
    // },

    /**
     * AI Configuration (Bedrock)
     * Amazon Bedrock for AI/ML model access
     */
    // ai: {
    //   models: ['anthropic.claude-3-5-sonnet-20241022-v2:0'],
    //   allowStreaming: true,
    //   service: 'ecs', // 'ecs' | 'ec2' | 'lambda'
    // },

    /**
     * Tunnel Configuration
     *
     * Deploy a custom tunnel server for `buddy share`.
     * Only needed if you want your own tunnel domain — localtunnel.dev
     * is the shared Stacks default and requires no deployment.
     *
     * Set enabled: true and provide a custom domain to deploy a
     * dedicated tunnel server via `buddy deploy:tunnel`.
     */
    // tunnel: {
    //   enabled: false,
    //   // domain: 'tunnel.mycompany.com',  // must NOT be localtunnel.dev
    //   // region: 'us-east-1',
    //   // ssl: { enabled: true },
    // },

    /**
     * Mail DNS is NOT declared here.
     *
     * A `mail` block under `infrastructure` was added once in the belief that
     * ts-cloud published MX/SPF/DKIM/DMARC from it. It does not: `CloudConfig`
     * has no `mail` field, ts-cloud's only DKIM support is SES token CNAMEs,
     * and `infrastructure` accepts unknown keys — so the block typechecked,
     * read as authoritative, and did nothing. Every value in it was also
     * already contradicted by the live zone (selector `default` where the
     * server signs with `mail`, `mail.stacksjs.com` where the MX is
     * `mail.theopentimes.org`, `p=none` where the record said `p=quarantine`).
     *
     * The records are published by `reconcileMailDns` in @stacksjs/buddy,
     * driven by config/email.ts — that is the file to edit.
     */

    /**
     * Monitoring Configuration (optional)
     */
    monitoring: {
      // Uncomment to add alarms
      // alarms: {
      //   'high-cpu': {
      //     metricName: 'CPUUtilization',
      //     namespace: 'AWS/EC2',
      //     threshold: 80,
      //     comparisonOperator: 'GreaterThanThreshold',
      //   },
      // },
    },
  },

  /**
   * Sites Configuration (optional)
   * For multi-site deployments
   */
  sites: {
    // The canonical host — `theopentimes.org`, or `opentimes.stacksjs.com` when
    // DOMAIN_MODE=subdomain. Either way it is a host of its own rather than a
    // path on stacksjs.com, so it never competes with the apex app's `/` route
    // in the gateway's longest-prefix routing.
    main: {
      root: '.',
      path: '/',
      domain: domains.canonical,
      // The installed buddy ships this entry prebuilt. Stacks itself compiles
      // an equivalent from `core/buddy/src/serve-entry.ts` during deploy, but a
      // consumer app has no framework source to build from — it has the package.
      start: 'bun node_modules/@stacksjs/buddy/dist/serve-entry.js',
      // Distinct from the apex app's :3000 — both processes share this box and
      // the gateway proxies each subdomain to its own loopback port.
      port: 3100,
      /*
       * This site's share of a shared box, and deliberately the loosest of the
       * three.
       *
       * A fresh process serves this app in about 200 MB. It does not stay
       * there: rendering a page whose components carry `<script server>` blocks
       * leaks roughly 5 MB per request under the stx this release resolves, so
       * `/` — the only view here built from components — walks the process
       * upwards all day. It reached 3.2 GB in about twenty hours and took the
       * whole host down with it, every other tenant included.
       *
       * So these are sized against the leak rather than against the workload.
       * 512M would be right for what this app actually needs and would restart
       * it every few hours until the leak is gone, which trades one outage for
       * a steady drip of dropped requests. `memoryMax` is the part that matters
       * meanwhile: the kernel OOM-kills inside this cgroup alone and
       * `Restart=always` brings it back, so the cost of the leak is charged to
       * this app instead of to the machine.
       *
       * Tighten to 512M/768M once the stx fix lands and RSS is flat under load
       * — the ceiling should be sized to the workload, not to a defect.
       */
      memoryHigh: '2G',
      memoryMax: '2560M',
      preStart: [
        // The database lives outside the release tree (see DB_DATABASE_PATH) so
        // it survives deploys; create it before migrating into it.
        `mkdir -p ${DATA_DIR}`,
        'bun install --production',
        /*
         * `--force` is here for one deploy only. REVERT IT once this lands.
         *
         * Deploys have been blocked since the schema grew two drops —
         * `categorizable_models` and `taggable_models`, both empty in
         * production — and migrate rightly refuses destructive changes with
         * nobody to ask. Dropping them by hand on the box did not clear it:
         * the diff is computed from the model snapshot rather than the live
         * database, so it still plans the drops against a schema that no
         * longer has them.
         *
         * The flag is what the framework offers for exactly this, and the two
         * tables carry no rows, but leaving it on would mean every future
         * deploy silently applies whatever destructive change happens to be
         * pending. That guard is worth keeping, so this comes straight back
         * out in the next commit.
         */
        './buddy migrate --force',
      ],
      // The page server reverse-proxies `/api/**` to the API process. Name that
      // port explicitly: the framework default (3008) is already owned by a
      // *different* tenant on this shared box, and an unconfigured proxy would
      // post The Open Times' form submissions into that app instead.
      // BROADCAST_REDIS_ENABLED makes this process publish realtime events to
      // Redis instead of to an in-process server it does not have. The
      // broadcast service relays them to the sockets.
      env: { PORT_API: '3101', DB_DATABASE_PATH, BROADCAST_REDIS_ENABLED: 'true' },
      exclude: RELEASE_EXCLUDES,
    },

    /**
     * The realtime broadcast server.
     *
     * A site rather than a bare process so ts-cloud owns its systemd unit,
     * its restarts and its release directory, exactly like the two app
     * processes. It carries the canonical domain with a `/ws` path, which is
     * how rpx routes by host *and* path: `wss://<domain>/ws` reaches loopback
     * :6001 while every other path on the same host still goes to the app.
     *
     * Fronting it through the gateway rather than opening 6001 publicly is not
     * a preference. A page served over https cannot open a `ws:` connection at
     * all, and port 6001 has no certificate of its own, so a direct-port
     * socket is unreachable from the deployed site. Through rpx it inherits
     * the site's certificate and needs no DNS record, no second cert and no
     * CORS exemption.
     *
     * Redis is what joins this process to the app's. `emit` resolves a
     * module-level server instance, so an in-process emit from the web service
     * would reach nobody here; the app publishes to Redis and this relays to
     * its sockets. Without the flag the two halves cannot see each other and
     * every event is dropped silently.
     */
    broadcast: {
      root: '.',
      domain: domains.canonical,
      path: '/ws',
      start: 'bun app/Broadcast/server.ts',
      port: 6001,
      /*
       * Relaying Redis messages to sockets is the whole job, so this one is
       * small and stays small: measured at 16-21 MB across a week of uptime.
       * 192M is roughly ten times that — enough that a burst of connections is
       * never the thing that trips it, low enough that a runaway is caught
       * while it is still cheap.
       */
      memoryHigh: '192M',
      memoryMax: '256M',
      preStart: [
        // Redis lives on the box rather than as a managed service: it carries
        // realtime fan-out between two processes on this same host, so a
        // network hop to a managed cluster would add latency and a failure
        // mode for no benefit. Idempotent, and it binds loopback by default on
        // Debian, which is the only interface that should reach it.
        'command -v redis-server >/dev/null 2>&1 || (apt-get update -y && apt-get install -y redis-server)',
        'systemctl enable --now redis-server',
        'bun install --production',
      ],
      env: {
        BROADCAST_HOST: '127.0.0.1',
        BROADCAST_PORT: '6001',
        BROADCAST_REDIS_ENABLED: 'true',
        DB_DATABASE_PATH,
      },
      exclude: RELEASE_EXCLUDES,
    },

    // The Open Times' own API process, bound to loopback and reached only through
    // the main site's `/api/**` proxy — so it needs no domain of its own.
    // Unlike the framework repo, a consumer app has no framework source to
    // compile an entry from: the installed package ships one prebuilt.
    api: {
      root: '.',
      start: 'bun node_modules/@stacksjs/actions/dist/serve/api.js',
      port: 3101,
      /*
       * The API serves JSON off the same database and holds flat at 39-66 MB
       * over a week — it renders no views, so it never touches the component
       * path that makes `main` above grow. 384M leaves generous room for a
       * heavier request without leaving room for an unbounded one.
       */
      memoryHigh: '384M',
      memoryMax: '512M',
      preStart: [
        `mkdir -p ${DATA_DIR}`,
        'bun install --production',
      ],
      // Same database file as the main site — the API is where every write
      // actually lands, so the two must not drift onto separate copies.
      env: {
        HOST: '127.0.0.1',
        APP_ENV: 'production',
        NODE_ENV: 'production',
        DB_DATABASE_PATH,
        // String(): the env proxy coerces values that look numeric or boolean,
        // so these are typed string|number|boolean while a site's env map takes
        // strings only.
        AI_PROVIDER: String(env.AI_PROVIDER || 'openai'),
        OPENAI_MODEL: String(env.OPENAI_MODEL || 'gpt-5.6-terra'),
        ...(env.OPENAI_API_KEY ? { OPENAI_API_KEY: String(env.OPENAI_API_KEY) } : {}),
        ...(env.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: String(env.ANTHROPIC_API_KEY) } : {}),
      },
      exclude: RELEASE_EXCLUDES,
    },

    /**
     * Every other host we own — the short domains, the `www.` form, and
     * whichever of the apex/subdomain pair is not currently canonical. Each is
     * a gateway-only virtual host that 301s to the canonical URL with its path
     * intact; none of them deploys a release or runs a process.
     *
     * Spread last so that if a redirect entry ever collided with `main` or
     * `api` the collision would be visible here rather than silently shadowing
     * a real site. It cannot collide today: `redirectSites()` derives its keys
     * from the domain list and skips the canonical host by construction.
     */
    ...domains.redirectSites(),
  },
}

// Stacks cloud configuration (for existing Stacks cloud features)
const config: CloudConfig = {
  // Add Stacks-specific cloud config here if needed
}

export default config
