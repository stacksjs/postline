/**
 * An error whose message was written for the person using Postline.
 *
 * Actions pass a message to the client only when it was meant for them (see
 * `action-error.ts`). A plain `Error` thrown by app code already counts. This
 * is for the cases that want a class of their own, so the code that catches
 * them can tell them apart, without losing that.
 */
export class UserFacingError extends Error {}
