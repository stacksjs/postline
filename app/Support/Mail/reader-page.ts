/**
 * The page a reader lands on after clicking a link in an email.
 *
 * Confirming and unsubscribing are the only two routes in the app reached from
 * a mail client rather than from the app, and a reader who clicks one is owed
 * a sentence in their own language, not a JSON body. There is no session and
 * no navigation here on purpose: the link did its work, and the page's only
 * job is to say so.
 *
 * Self-contained markup rather than a template, because these render in the
 * long tail of contexts a mail link opens in, including browsers with the app's
 * assets blocked.
 */

export interface ReaderPageOptions {
  title: string
  message: string
  /** Where to send them next, when there is somewhere worth going. */
  action?: { href: string, label: string }
  tone?: 'ok' | 'error'
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function readerPage(options: ReaderPageOptions): string {
  const accent = options.tone === 'error' ? '#b91c1c' : '#09090b'

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(options.title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 24px;
        background: #f4f4f2; color: #27272a;
        font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  main { max-width: 30rem; width: 100%; background: #fff; border-radius: 14px; padding: 32px; text-align: center; }
  h1 { margin: 0 0 12px; font-size: 20px; line-height: 1.3; color: ${accent}; }
  p { margin: 0; color: #52525b; }
  a.action { display: inline-block; margin-top: 24px; padding: 11px 18px; border-radius: 10px;
            background: #09090b; color: #fff; text-decoration: none; font-size: 15px; }
  @media (prefers-color-scheme: dark) {
    body { background: #0a0a0a; color: #d4d4d8; }
    main { background: #171717; }
    h1 { color: ${options.tone === 'error' ? '#f87171' : '#fafafa'}; }
    p { color: #a1a1aa; }
    a.action { background: #fafafa; color: #09090b; }
  }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(options.title)}</h1>
  <p>${escapeHtml(options.message)}</p>
  ${options.action ? `<a class="action" href="${escapeHtml(options.action.href)}">${escapeHtml(options.action.label)}</a>` : ''}
</main>
</body>
</html>`
}
