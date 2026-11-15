import type { RequestMacroMethods } from '@stacksjs/bun-router'
import type { RequestInstance } from '@stacksjs/types'
import { Action } from '@stacksjs/actions'
import { env } from '@stacksjs/env'
import { stripe } from '@stacksjs/payments'
import { response } from '@stacksjs/router'
import { billing } from '../../Services/BillingService'

/**
 * Stripe's webhook endpoint.
 *
 * Unauthenticated by necessity, so the signature is the only thing standing
 * between this route and anyone who can guess its URL. It is verified against
 * the exact bytes Stripe sent, read through `rawBody()` rather than the parsed
 * body, because re-serialising JSON changes key order and whitespace and would
 * fail every signature check.
 *
 * A missing secret is treated as a hard failure rather than as "skip
 * verification". An endpoint that accepts unsigned subscription events is a
 * way to grant yourself a paid subscription for free.
 */
export default new Action({
  name: 'Postline Stripe Webhook',
  description: 'Apply Stripe subscription events to publication readers.',
  method: 'POST',

  async handle(request: RequestInstance) {
    /**
     * bun-router installs a set of request macros that `RequestInstance` from
     * `@stacksjs/types` does not describe, and `rawBody` is one of them. The
     * parameter type is fixed by `Action`, so the widening happens here,
     * asserted to the router's own `RequestMacroMethods` rather than to `any`:
     * the method genuinely exists at runtime and is declared upstream, it is
     * simply absent from the narrower alias every other action is satisfied by.
     *
     * Worth fixing in `@stacksjs/types` so this assertion can go away.
     */
    const macros = request as RequestInstance & Pick<RequestMacroMethods, 'rawBody' | 'header'>
    const secret = String(env.STRIPE_WEBHOOK_SECRET || '').trim()
    if (!secret) {
      return response.json({ ok: false, error: 'Stripe webhooks are not configured.' }, { status: 503 })
    }

    const signature = String(macros.header('stripe-signature') || '')
    if (!signature) {
      return response.json({ ok: false, error: 'Missing signature.' }, { status: 400 })
    }

    let event: { type?: string, data?: { object?: any } }
    try {
      const payload = await macros.rawBody()
      // `constructEventAsync`, not `constructEvent`. Bun has no synchronous
      // crypto provider for the Stripe SDK, so the sync call throws
      // "SubtleCryptoProvider cannot be used in a synchronous context" on
      // every delivery. The async variant uses SubtleCrypto and is the only
      // one that works on this runtime.
      event = await stripe.webhooks.constructEventAsync(payload, signature, secret) as any
    }
    catch (error) {
      // Deliberately terse. A verification failure should not tell an attacker
      // which part of their forgery was wrong.
      return response.json({ ok: false, error: 'Signature verification failed.' }, { status: 400 })
    }

    try {
      const result = await billing.handleWebhook(event)

      // Unhandled event types still return 200. Replying with an error to an
      // event we do not care about makes Stripe retry it indefinitely.
      return response.json({ ok: true, data: result })
    }
    catch (error) {
      // A real processing failure does want a retry, so this one is a 500.
      return response.json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }, { status: 500 })
    }
  },
})
