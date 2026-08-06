/**
 * The double opt-in confirmation mail.
 *
 * Without this the opt-in is a dead end: a reader is told to check their inbox
 * and nothing arrives. The token only exists to be delivered here.
 *
 * Deliberately plain. This is a transactional mail whose entire job is to get
 * one link clicked, and a designed newsletter template competing with that link
 * lowers the confirmation rate rather than raising it.
 */

import { mail } from '@stacksjs/email'
import { env } from '@stacksjs/env'
import { config } from '@stacksjs/config'
import { checkoutBaseUrl } from '../Services/BillingService'

export interface PublicationConfirmationOptions {
  to: string
  publicationName: string
  confirmationToken: string
  /** Included so a reader can leave without confirming first. */
  unsubscribeToken?: string
}

export async function sendPublicationConfirmation(options: PublicationConfirmationOptions): Promise<void> {
  const base = checkoutBaseUrl(env.APP_URL)
  const confirmUrl = `${base}/api/ot/subscribe/confirm?token=${encodeURIComponent(options.confirmationToken)}`
  const subject = `Confirm your subscription to ${options.publicationName}`

  const text = [
    `Confirm your subscription to ${options.publicationName}:`,
    '',
    confirmUrl,
    '',
    'If you did not ask for this, ignore this email and nothing more will be sent.',
  ].join('\n')

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f2;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2;">
<tr><td style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;">
<tr><td style="padding:32px;">
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#09090b;">Confirm your subscription</h1>
<p style="margin:0 0 24px;line-height:1.6;color:#3f3f46;font-size:15px;">One click and you are on the list for ${escapeHtml(options.publicationName)}.</p>
<p style="margin:0 0 24px;"><a href="${escapeHtml(confirmUrl)}" style="display:inline-block;padding:12px 20px;background:#09090b;color:#ffffff;text-decoration:none;border-radius:10px;font-size:15px;">Confirm subscription</a></p>
<p style="margin:0;line-height:1.6;color:#71717a;font-size:13px;">If you did not ask for this, ignore this email and nothing more will be sent.</p>
</td></tr>
</table></td></tr></table></body></html>`

  await mail.send({
    to: [options.to],
    from: {
      name: options.publicationName,
      address: config.email?.from?.address || String(env.MAIL_FROM_ADDRESS || 'hello@example.com'),
    },
    subject,
    html,
    text,
  })
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export default sendPublicationConfirmation
