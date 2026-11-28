/**
 * The stx conformance checks (`./buddy lint --stx`, run in CI).
 *
 * A baseline is the most a check may find. It is today's count, so CI fails
 * the moment a view gets worse (a new document.querySelector, a new inline
 * style), and each number comes down as views move to signals. Lower a
 * baseline when a rewrite lowers its count; never raise one to let a change
 * through (#77).
 */
export default {
  stx: {
    baselines: {
      // Direct DOM access in Composer, Settings and Channels.
      'dom-guard': 12,
      'style-block': 1,
      // Marketing links that are plain anchors.
      'plain-internal-anchor': 3,
      'unmanaged-timer': 0,
    },
  },
}
