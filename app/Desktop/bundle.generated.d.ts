// Written by scripts/desktop-bundle.ts. Do not edit.

/** A route file as `app/Routes.ts` mounts it. */
export declare const routes: Array<{ load: () => Promise<unknown>, prefix?: string, middleware?: string[] }>

/** Every action the route files name by string, by that name. */
export declare const actions: Record<string, () => Promise<{ default?: unknown }>>
