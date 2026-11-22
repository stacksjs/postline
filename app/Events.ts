/**
 * **Events Configuration**
 *
 * This configuration defines all of your events. Because Stacks is fully-typed, you may
 * hover any of the options below and the definitions will be provided. In case you
 * have any questions, feel free to reach out via Discord or GitHub Discussions.
 */
// Annotated, not `satisfies Events`: with no events declared, `satisfies`
// narrows the map to `{}` and the listener that indexes it stops type checking.
const events: Record<string, string[]> = {
  // eventName: ['Listener1', 'Listener2'] -> listeners default to ./app/actions/*
}

export default events
