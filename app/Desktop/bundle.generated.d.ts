// Written by scripts/desktop-bundle.ts. Do not edit.

type Loader = () => Promise<{ default?: unknown }>

interface Runnable {
  name: string
  handle?: (...args: any[]) => unknown
}

/** The built, migrated, empty database, as a path the process can read. */
export declare const databaseTemplate: string

/** A route file as `app/Routes.ts` mounts it. */
export declare const routes: Array<{ load: () => Promise<unknown>, prefix?: string, middleware?: string[] }>

/** Every action the route files name by string, by that name. */
export declare const actions: Record<string, Loader>

/** Every middleware, by class name. */
export declare const middleware: Record<string, Loader>

/** Every migration the database template was made from: file name to SQL. */
export declare const migrations: Record<string, string>

/** The workspace's client scripts as browser JavaScript, by the URL the pages ask for. */
export declare const clientScripts: Record<string, string>

/** The recurring jobs, loaded on demand. */
export declare function jobs(): Promise<{
  publishScheduledPosts: Runnable
  syncEngagementMetrics: Runnable
  scanKeywordMonitors: Runnable
  syncDirectMessages: Runnable
  autoDeletePosts: Runnable
}>
