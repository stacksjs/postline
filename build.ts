#!/usr/bin/env bun
/**
 * Static build entrypoint.
 *
 * Framework is a node_modules dependency now, so the app owns its build:
 * `@stacksjs/stx`'s buildApp() compiles this project's resources/views into
 * dist/. `buddy build` prefers this project-local build.ts over the framework
 * default when it exists (see @stacksjs/actions build/views).
 */
import { buildApp } from '@stacksjs/stx'

// eslint-disable-next-line ts/no-top-level-await
await buildApp()
