import { providerLabel } from '../../functions/networks'
import { escapeHtml } from '../../functions/postline-client'

type Point = {
  label: string
  value: number
}

// Minimal local versions of d3-style helpers. The published @ts-charts
// packages declare a `bun` export condition pointing at an unshipped src/
// directory, so they can never bundle under Bun's dev server — and this
// chart only needs a linear scale, a line path, and nice ticks.
function makeLinearScale(domain: [number, number], range: [number, number]): (value: number) => number {
  const [d0, d1] = domain
  const [r0, r1] = range
  const slope = d1 - d0 === 0 ? 0 : (r1 - r0) / (d1 - d0)
  return value => r0 + (value - d0) * slope
}

function linePath(coordinates: Array<[number, number]>): string {
  return coordinates.map(([px, py], index) => `${index === 0 ? 'M' : 'L'}${px},${py}`).join('')
}

function niceTicks(min: number, max: number, count: number): number[] {
  if (max <= min) return [min]
  const step0 = (max - min) / Math.max(1, count)
  const magnitude = 10 ** Math.floor(Math.log10(step0))
  const normalized = step0 / magnitude
  const step = (normalized >= 5 ? 10 : normalized >= 2 ? 5 : normalized >= 1 ? 2 : 1) * magnitude
  const result: number[] = []
  for (let value = Math.ceil(min / step) * step; value <= max + 1e-9; value += step)
    result.push(Number(value.toFixed(10)))
  return result
}

interface AnalyticsPayload {
  stats: {
    postsThisWeek: number
    postsLastWeek: number
    bestChannel: { provider: string, count: number, average: number } | null
    bestHour: { hour: number, count: number, average: number } | null
    engagement?: { likes: number, reposts: number, replies: number, syncedTargets: number, providers: string[] }
    minSample: number
  }
  series: Point[]
  channelMix: Array<{ provider: string, published: number, share: number }>
  windows: Array<{ hour: number, count: number }>
}

// Populated from /api/postline/analytics before the chart renders.
let points: Point[] = []
let analyticsPromise: Promise<AnalyticsPayload | null> | null = null

const drawn = new WeakMap<SVGSVGElement, { width: number, points: Point[], events: AbortController }>()
const blue = '#2563eb'
const text = '#18181b'
const muted = '#71717a'
const rule = '#e4e4e7'

function formatTick(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function renderAnalyticsChart(): void {
  const chart = document.querySelector<SVGSVGElement>('[data-analytics-chart]')
  if (!chart || points.length < 2 || !chart.clientWidth) return

  const width = Math.max(240, Math.min(640, chart.clientWidth))
  const previous = drawn.get(chart)
  if (previous?.width === width && previous.points === points) return
  previous?.events.abort()
  const events = new AbortController()
  drawn.set(chart, { width, points, events })

  const compact = width < 460
  const height = compact ? 235 : 280
  const inset = compact ? { top: 38, right: 28, bottom: 50, left: 40 } : { top: 46, right: 36, bottom: 58, left: 56 }
  chart.setAttribute('viewBox', `0 0 ${width} ${height}`)
  const size = (selector: string) => {
    const rect = chart.querySelector(selector)
    rect?.setAttribute('width', String(width))
    rect?.setAttribute('height', String(height))
  }
  size('[data-chart-background]')
  size('[data-chart-hit-area]')

  const maxValue = Math.max(...points.map(point => point.value))
  const yMax = Math.max(4, Math.ceil((maxValue + 1) / 2) * 2)
  const x = makeLinearScale([0, points.length - 1], [inset.left, width - inset.right])
  const y = makeLinearScale([0, yMax], [height - inset.bottom, inset.top])

  const path = linePath(points.map((point, index) => [x(index), y(point.value)]))
  const baseline = height - inset.bottom
  const firstX = x(0)
  const lastX = x(points.length - 1)
  const areaPath = `${path}L${lastX},${baseline}L${firstX},${baseline}Z`
  const yTicks = niceTicks(0, yMax, 4)
  const tickStride = compact ? 10 : 5
  const xTickIndexes = points.map((_point, index) => index)
    .filter(index => index === 0 || index === points.length - 1 || (index % tickStride === 0 && index < points.length - 3))

  chart.querySelector<SVGPathElement>('[data-chart-line]')?.setAttribute('d', path)
  chart.querySelector<SVGPathElement>('[data-chart-area]')?.setAttribute('d', areaPath)

  const grid = chart.querySelector<SVGGElement>('[data-chart-grid]')
  if (grid) {
    grid.innerHTML = yTicks
      .map((tick) => {
        const yy = y(tick)
        return `<line x1="${inset.left}" x2="${width - inset.right}" y1="${yy}" y2="${yy}" stroke="${rule}" stroke-width="1"></line>`
      })
      .join('')
  }

  const yAxis = chart.querySelector<SVGGElement>('[data-chart-y-axis]')
  if (yAxis) {
    yAxis.innerHTML = yTicks
      .map((tick) => {
        const yy = y(tick)
        return `<g transform="translate(0 ${yy})"><line x1="${inset.left - 5}" x2="${inset.left}" stroke="${rule}" stroke-width="1"></line><text x="${inset.left - 10}" y="4" text-anchor="end" fill="${muted}" font-size="12">${formatTick(tick)}</text></g>`
      })
      .join('')
  }

  const xAxis = chart.querySelector<SVGGElement>('[data-chart-x-axis]')
  if (xAxis) {
    xAxis.innerHTML = [
      `<line x1="${inset.left}" x2="${width - inset.right}" y1="${baseline}" y2="${baseline}" stroke="${rule}" stroke-width="1"></line>`,
      ...xTickIndexes.map((index) => {
        const xx = x(index)
        return `<g transform="translate(${xx} 0)"><line y1="${baseline}" y2="${baseline + 5}" stroke="${rule}" stroke-width="1"></line><text y="${baseline + 22}" text-anchor="middle" fill="${muted}" font-size="12">${escapeHtml(points[index]!.label)}</text></g>`
      }),
    ].join('')
  }

  const labels = chart.querySelector<SVGGElement>('[data-chart-labels]')
  if (labels) {
    labels.innerHTML = [
      `<text x="${inset.left}" y="24" fill="${muted}" font-size="11" font-weight="700">Posts published</text>`,
      `<text x="${width - inset.right}" y="${height - 14}" text-anchor="end" fill="${muted}" font-size="11" font-weight="700">Date</text>`,
    ].join('')
  }

  const legend = chart.querySelector<SVGGElement>('[data-chart-legend]')
  if (legend) {
    legend.innerHTML = compact ? '' : [
      `<circle cx="${width - 212}" cy="22" r="4" fill="${blue}"></circle>`,
      `<text x="${width - 202}" y="26" fill="${text}" font-size="11" font-weight="700">Publishing activity</text>`,
      `<rect x="${width - 82}" y="16" width="22" height="8" rx="4" fill="rgba(37, 99, 235, 0.12)"></rect>`,
      `<text x="${width - 28}" y="26" fill="${muted}" font-size="11" text-anchor="end">30 days</text>`,
    ].join('')
  }

  const pointLayer = chart.querySelector<SVGGElement>('[data-chart-points]')
  if (pointLayer) {
    pointLayer.innerHTML = points
      .map((point, index) => `<circle cx="${x(index)}" cy="${y(point.value)}" r="4" fill="#fff" stroke="${blue}" stroke-width="3"><title>${escapeHtml(point.label)}: ${point.value} post${point.value === 1 ? '' : 's'} published</title></circle>`)
      .join('')
  }

  const hoverLayer = chart.querySelector<SVGGElement>('[data-chart-hover]')
  const hitArea = chart.querySelector<SVGRectElement>('[data-chart-hit-area]')

  let activeIndex = points.length - 1

  const showHover = (index: number): void => {
    activeIndex = Math.max(0, Math.min(points.length - 1, index))
    const point = points[activeIndex]
    if (!point) return
    const xx = x(activeIndex)
    const yy = y(point.value)
    const tooltipWidth = 154
    const tooltipHeight = 48
    const tooltipX = Math.min(Math.max(xx + 14, inset.left), width - inset.right - tooltipWidth)
    const tooltipY = Math.max(inset.top + 8, yy - tooltipHeight - 14)

    if (hoverLayer) {
      hoverLayer.innerHTML = [
        `<line x1="${xx}" x2="${xx}" y1="${inset.top}" y2="${baseline}" stroke="${blue}" stroke-width="1.5" stroke-dasharray="4 4" opacity="0.55"></line>`,
        `<circle cx="${xx}" cy="${yy}" r="7" fill="#fff" stroke="${blue}" stroke-width="3"></circle>`,
        `<g transform="translate(${tooltipX} ${tooltipY})" data-chart-tooltip>`,
        `<rect width="${tooltipWidth}" height="${tooltipHeight}" rx="12" fill="#fff" stroke="#d4d4d8" stroke-width="1.2"></rect>`,
        `<text x="12" y="22" fill="${text}" font-size="12" font-weight="800">${escapeHtml(point.label)}</text>`,
        `<text x="12" y="38" fill="${muted}" font-size="11">${point.value} post${point.value === 1 ? '' : 's'} published</text>`,
        '</g>',
      ].join('')
      hoverLayer.removeAttribute('aria-hidden')
    }

    if (hitArea)
      hitArea.setAttribute('aria-label', `${point.label}: ${point.value} post${point.value === 1 ? '' : 's'} published`)
  }

  const hideHover = (): void => {
    hoverLayer?.setAttribute('aria-hidden', 'true')
    if (hoverLayer)
      hoverLayer.innerHTML = ''
  }

  const pointIndexFromPointer = (event: PointerEvent): number => {
    const transform = chart.getScreenCTM()
    let svgX = 0

    if (transform) {
      const point = chart.createSVGPoint()
      point.x = event.clientX
      point.y = event.clientY
      svgX = point.matrixTransform(transform.inverse()).x
    }
    else {
      const rect = chart.getBoundingClientRect()
      svgX = ((event.clientX - rect.left) / rect.width) * width
    }

    const step = (width - inset.left - inset.right) / (points.length - 1)
    return Math.round((svgX - inset.left) / step)
  }

  const options = { signal: events.signal }
  chart.addEventListener('pointermove', event => showHover(pointIndexFromPointer(event)), options)
  chart.addEventListener('pointerleave', hideHover, options)
  hitArea?.addEventListener('focus', () => showHover(activeIndex), options)
  hitArea?.addEventListener('blur', hideHover, options)
  hitArea?.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    showHover(activeIndex + (event.key === 'ArrowRight' ? 1 : -1))
  }, options)
  hideHover()
  if (document.activeElement === hitArea) showHover(activeIndex)

}

/**
 * An hour of the day as the reader's locale writes it. The hour is already
 * on the workspace's clock (the server buckets in its time zone), so it is
 * formatted as it stands and not shifted into the browser's zone.
 */
function formatHour(hour: number): string {
  const clock = new Date(Date.UTC(2000, 0, 1, hour, 0, 0))
  return clock.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
}

function fillStats(payload: AnalyticsPayload): void {
  const page = document.querySelector<HTMLElement>('[data-testid="analytics-page"]')
  // The mount observer refires on any DOM change; fill once per page mount
  // or the fill's own mutations retrigger it in a microtask loop.
  if (!page || page.dataset.analyticsFilled === 'true') return

  // `payload.data` reaches here through an `as` cast, so nothing has checked
  // its shape at runtime. A response missing `stats` used to throw an uncaught
  // TypeError on the first read — and because the fill-once latch was set
  // above this line, the page stayed marked filled and could never recover.
  // The fetch's own catch never saw it either, because it happens after the
  // promise resolves. Latch after the guard so a later attempt can succeed.
  const stats = payload?.stats
  if (!stats) {
    showAnalyticsError('Analytics data was incomplete.')
    return
  }
  page.dataset.analyticsFilled = 'true'

  const delta = stats.postsThisWeek - stats.postsLastWeek
  const set = (selector: string, value: string): void => {
    const element = page.querySelector(selector)
    if (element) element.textContent = value
  }

  set('[data-analytics-posts-week]', String(stats.postsThisWeek))
  set('[data-analytics-posts-trend]', `${delta >= 0 ? '+' : ''}${delta} from last week`)

  const engagement = stats.engagement
  const interactions = engagement ? engagement.likes + engagement.reposts + engagement.replies : 0
  set('[data-analytics-engagement]', engagement?.syncedTargets ? String(interactions) : 'Not available')
  const measuredNetworks = engagement?.providers?.map(providerLabel).join(', ')
  set(
    '[data-analytics-engagement-trend]',
    engagement?.syncedTargets
      ? `${measuredNetworks || 'Measured posts'} · ${engagement.likes} likes · ${engagement.reposts} reposts · ${engagement.replies} replies`
      : 'Syncs after publishing to Bluesky',
  )
  const sampleLabel = ({ average, count }: { average: number, count: number }): string =>
    `${average.toLocaleString(undefined, { maximumFractionDigits: 1 })} interactions per post across ${count} posts`
  set('[data-analytics-best-channel]', stats.bestChannel ? providerLabel(stats.bestChannel.provider) : 'No recommendation')
  set('[data-analytics-best-channel-trend]', stats.bestChannel ? sampleLabel(stats.bestChannel) : `Needs a clear leader and ${stats.minSample} measured posts on each of two channels`)
  set('[data-analytics-best-window]', stats.bestHour ? formatHour(stats.bestHour.hour) : 'No recommendation')
  set('[data-analytics-best-window-trend]', stats.bestHour ? sampleLabel(stats.bestHour) : `Needs a clear leader and ${stats.minSample} measured posts in each of two hours`)

  const mix = page.querySelector('[data-analytics-channel-mix]')
  if (mix) {
    mix.innerHTML = (payload.channelMix ?? []).length
      ? (payload.channelMix ?? []).map(channel => `
          <div class="grid gap-1.5">
            <div class="flex items-center justify-between text-xs">
              <span class="font-bold">${escapeHtml(providerLabel(channel.provider))}</span>
              <span class="text-muted">${channel.share}%</span>
            </div>
            <div class="overflow-hidden h-2 bg-panel-2 rounded-full">
              <div class="h-full bg-net-bluesky rounded-full" style="width: ${channel.share}%"></div>
            </div>
          </div>
        `).join('')
      : '<p class="m-0 text-muted text-xs">Publish a post to see the channel mix.</p>'
  }

  const windows = page.querySelector('[data-analytics-windows]')
  if (windows) {
    windows.innerHTML = (payload.windows ?? []).length
      ? (payload.windows ?? []).map(window_ => `
          <div class="flex items-center justify-between">
            <span>${window_.count} post${window_.count === 1 ? '' : 's'}</span>
            <span class="font-semibold text-ink">${formatHour(window_.hour)}</span>
          </div>
        `).join('')
      : '<p class="m-0 text-xs">No publishing history yet.</p>'
  }
}

let lastAnalyticsError: string | null = null

function hideAnalyticsError(): void {
  const banner = document.querySelector<HTMLElement>('[data-analytics-error]')
  if (banner) {
    banner.classList.add('hidden')
    banner.classList.remove('flex')
  }
}

function showAnalyticsError(message: string): void {
  const page = document.querySelector<HTMLElement>('[data-testid="analytics-page"]')
  if (!page)
    return

  const msg = page.querySelector('[data-analytics-error-message]')
  if (msg)
    msg.textContent = message
  const banner = page.querySelector<HTMLElement>('[data-analytics-error]')
  if (banner) {
    banner.classList.remove('hidden')
    banner.classList.add('flex')
  }

  // Stop the stat trends from claiming they're still loading forever.
  page.querySelectorAll('[data-analytics-posts-trend], [data-analytics-engagement-trend], [data-analytics-best-channel-trend], [data-analytics-best-window-trend]')
    .forEach((el) => { if (el.textContent === 'Loading…') el.textContent = 'Unavailable' })

  const retry = page.querySelector<HTMLElement>('[data-analytics-retry]')
  if (retry && !retry.dataset.wired) {
    retry.dataset.wired = 'true'
    retry.addEventListener('click', () => {
      hideAnalyticsError()
      void loadAnalytics()
    })
  }
}

/** How long one fetch of the numbers serves repeat visits before it is asked for again (#182). */
const ANALYTICS_FRESH_MS = 60_000
let analyticsFetchedAt = 0

async function loadAnalytics(): Promise<void> {
  if (analyticsPromise && Date.now() - analyticsFetchedAt > ANALYTICS_FRESH_MS)
    analyticsPromise = null
  if (!analyticsPromise) {
    analyticsFetchedAt = Date.now()
    analyticsPromise = fetch('/api/postline/analytics')
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok || !payload.ok) throw new Error(payload.error || 'Could not load analytics.')
        lastAnalyticsError = null
        return payload.data as AnalyticsPayload
      })
      .catch((error: unknown) => {
        analyticsPromise = null
        lastAnalyticsError = error instanceof Error ? error.message : 'Could not load analytics.'
        return null
      })
  }

  const data = await analyticsPromise
  if (!data) {
    // Previously returned silently, leaving the dashboard stuck on "Loading…".
    showAnalyticsError(lastAnalyticsError || 'Could not load analytics.')
    return
  }
  hideAnalyticsError()
  points = data.series || []
  fillStats(data)
  scheduleAnalyticsRender()
}

let renderFrame = 0

function scheduleAnalyticsRender(): void {
  if (renderFrame) return

  renderFrame = window.requestAnimationFrame(() => {
    renderFrame = 0
    renderAnalyticsChart()
  })
}

let observedChart: SVGSVGElement | null = null
const chartResize = new ResizeObserver(scheduleAnalyticsRender)

window.addEventListener('stx:load', () => {
  if (!observedChart || observedChart.isConnected) return
  chartResize.disconnect()
  observedChart = null
})

function mountAnalyticsIfShown(): void {
  const chart = document.querySelector<SVGSVGElement>('[data-analytics-chart]')
  if (!chart) return
  if (observedChart !== chart) {
    chartResize.disconnect()
    chartResize.observe(chart)
    observedChart = chart
  }
  void loadAnalytics()
  scheduleAnalyticsRender()
}

// view-code.ts imports this module the first time the analytics view is on
// the page and calls mountAnalyticsIfShown, then and after each navigation.
export { mountAnalyticsIfShown }


