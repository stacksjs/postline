import type { PostOptions } from '../../../app/Support/Social/post-options'

/** Network-specific fields are read only when this post is saved or published. */
export function readNetworkOptions(form: HTMLFormElement | null, networks: { mastodon: boolean, bluesky: boolean }) {
  if (!form) throw new Error('The network options did not load. Reopen Composer and try again.')
  const fields = new FormData(form)
  const value = (name: string) => String(fields.get(name) ?? '').trim()
  const choices = networks.mastodon ? value('pollChoices') : ''
  const labels = networks.bluesky ? value('blueskyLabels') : ''
  return {
    mastodon_poll: choices ? JSON.stringify({
      options: choices.split('\n').map(choice => choice.trim()).filter(Boolean),
      expiresIn: Number(value('pollMinutes')) * 60,
      multiple: fields.has('pollMultiple'),
      hideTotals: fields.has('pollHideTotals'),
    }) : '',
    mastodon_quote: networks.mastodon ? value('mastodonQuote') : '',
    bluesky_quote: networks.bluesky ? value('blueskyQuote') : '',
    bluesky_labels: labels ? JSON.stringify(labels.split(',').map(label => label.trim()).filter(Boolean)) : '',
  }
}

/** Restore a saved poll or quote without booting the module on a blank Composer. */
export function restoreNetworkOptions(form: HTMLFormElement | null, options: PostOptions): void {
  if (!form) throw new Error('The network options did not load. Reopen Composer and try again.')
  form.reset()
  const poll = options.mastodon?.poll
  for (const [name, value] of Object.entries({
    pollChoices: poll?.options.join('\n'),
    pollMinutes: poll && String(poll.expiresIn / 60),
    pollMultiple: Boolean(poll?.multiple),
    pollHideTotals: Boolean(poll?.hideTotals),
    mastodonQuote: options.mastodon?.quote,
    blueskyQuote: options.bluesky?.quote,
    blueskyLabels: options.bluesky?.selfLabels?.join(', '),
  })) {
    const field = form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null
    if (!field || value === undefined) continue
    if (typeof value === 'boolean') (field as HTMLInputElement).checked = value
    else field.value = value
  }
}
