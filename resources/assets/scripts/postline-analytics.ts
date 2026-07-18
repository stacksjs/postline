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
    bestChannel: { provider: string, published: number, share: number } | null
    bestHour: { hour: number, count: number } | null
  }
  series: Point[]
  channelMix: Array<{ provider: string, published: number, share: number }>
  windows: Array<{ hour: number, count: number }>
}

// Populated from /api/postline/analytics before the chart renders.
let points: Point[] = []
let analyticsPromise: Promise<AnalyticsPayload | null> | null = null

const width = 640
const height = 280
const inset = { top: 46, right: 34, bottom: 58, left: 56 }
const blue = '#2563eb'
const text = '#18181b'
const muted = '#71717a'
const rule = '#e4e4e7'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function formatTick(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function renderAnalyticsChart(): void {
  const chart = document.querySelector<SVGSVGElement>('[data-analytics-chart]')
  const existingPath = chart?.querySelector<SVGPathElement>('[data-chart-line]')?.getAttribute('d')
  if (!chart || (chart.dataset.rendered === 'true' && existingPath)) return
  if (points.length < 2) return

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
  const xTickIndexes = points.map((_point, index) => index)
    .filter(index => index === 0 || index === points.length - 1 || (index % 5 === 0 && index < points.length - 3))

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
        return `<g transform="translate(0 ${yy})"><line x1="${inset.left - 5}" x2="${inset.left}" stroke="${rule}" stroke-width="1"></line><text x="${inset.left - 10}" y="4" text-anchor="end" fill="${muted}" font-size="10">${formatTick(tick)}</text></g>`
      })
      .join('')
  }

  const xAxis = chart.querySelector<SVGGElement>('[data-chart-x-axis]')
  if (xAxis) {
    xAxis.innerHTML = [
      `<line x1="${inset.left}" x2="${width - inset.right}" y1="${baseline}" y2="${baseline}" stroke="${rule}" stroke-width="1"></line>`,
      ...xTickIndexes.map((index) => {
        const xx = x(index)
        return `<g transform="translate(${xx} 0)"><line y1="${baseline}" y2="${baseline + 5}" stroke="${rule}" stroke-width="1"></line><text y="${baseline + 22}" text-anchor="middle" fill="${muted}" font-size="10">${escapeHtml(points[index].label)}</text></g>`
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
    legend.innerHTML = [
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

  if (chart.dataset.hoverBound !== 'true') {
    chart.addEventListener('pointermove', (event) => {
      showHover(pointIndexFromPointer(event))
    })
    chart.addEventListener('pointerleave', hideHover)

    hitArea?.addEventListener('focus', () => showHover(activeIndex))
    hitArea?.addEventListener('blur', hideHover)
    hitArea?.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return

      event.preventDefault()
      showHover(activeIndex + (event.key === 'ArrowRight' ? 1 : -1))
    })

    chart.dataset.hoverBound = 'true'
  }

  chart.dataset.rendered = 'true'
}

const providerNames: Record<string, string> = {
  bluesky: 'Bluesky',
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  threads: 'Threads',
  twitter: 'Twitter/X',
  mastodon: 'Mastodon',
}

function formatHour(hour: number): string {
  const local = new Date()
  local.setUTCHours(hour, 0, 0, 0)
  return local.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function fillStats(payload: AnalyticsPayload): void {
  const page = document.querySelector<HTMLElement>('[data-testid="analytics-page"]')
  // The mount observer refires on any DOM change; fill once per page mount
  // or the fill's own mutations retrigger it in a microtask loop.
  if (!page || page.dataset.analyticsFilled === 'true') return
  page.dataset.analyticsFilled = 'true'

  const { stats } = payload
  const delta = stats.postsThisWeek - stats.postsLastWeek
  const set = (selector: string, value: string): void => {
    const element = page.querySelector(selector)
    if (element) element.textContent = value
  }

  set('[data-analytics-posts-week]', String(stats.postsThisWeek))
  set('[data-analytics-posts-trend]', `${delta >= 0 ? '+' : ''}${delta} from last week`)
  set('[data-analytics-best-channel]', stats.bestChannel ? (providerNames[stats.bestChannel.provider] || stats.bestChannel.provider) : '—')
  set('[data-analytics-best-channel-trend]', stats.bestChannel ? `${stats.bestChannel.published} published posts` : 'No published posts yet')
  set('[data-analytics-best-window]', stats.bestHour ? formatHour(stats.bestHour.hour) : '—')
  set('[data-analytics-best-window-trend]', stats.bestHour ? `${stats.bestHour.count} posts published` : 'No published posts yet')

  const mix = page.querySelector('[data-analytics-channel-mix]')
  if (mix) {
    mix.innerHTML = payload.channelMix.length
      ? payload.channelMix.map(channel => `
          <div class="grid gap-1.5">
            <div class="flex items-center justify-between text-xs">
              <span class="font-bold">${providerNames[channel.provider] || channel.provider}</span>
              <span class="text-zinc-500">${channel.share}%</span>
            </div>
            <div class="overflow-hidden h-2 bg-zinc-100 rounded-full">
              <div class="h-full bg-blue-600 rounded-full" style="width: ${channel.share}%"></div>
            </div>
          </div>
        `).join('')
      : '<p class="m-0 text-xs text-zinc-500">Publish a post to see the channel mix.</p>'
  }

  const windows = page.querySelector('[data-analytics-windows]')
  if (windows) {
    windows.innerHTML = payload.windows.length
      ? payload.windows.map(window_ => `
          <div class="flex items-center justify-between">
            <span>${window_.count} post${window_.count === 1 ? '' : 's'}</span>
            <span class="font-bold text-neutral-950">${formatHour(window_.hour)}</span>
          </div>
        `).join('')
      : '<p class="m-0 text-xs">No publishing history yet.</p>'
  }
}

async function loadAnalytics(): Promise<void> {
  if (!analyticsPromise) {
    analyticsPromise = fetch('/api/postline/analytics')
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok || !payload.ok) throw new Error(payload.error || 'Could not load analytics.')
        return payload.data as AnalyticsPayload
      })
      .catch(() => {
        analyticsPromise = null
        return null
      })
  }

  const data = await analyticsPromise
  if (!data) return
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

function watchAnalyticsChartMounts(): void {
  if (document.querySelector('[data-analytics-chart]')) void loadAnalytics()
  scheduleAnalyticsRender()

  const target = document.body || document.documentElement
  if (!target) return

  const observer = new MutationObserver(() => {
    if (document.querySelector('[data-analytics-chart]:not([data-rendered="true"])')) {
      void loadAnalytics()
      scheduleAnalyticsRender()
    }
  })

  observer.observe(target, { childList: true, subtree: true })
}

if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', watchAnalyticsChartMounts, { once: true })
else
  watchAnalyticsChartMounts()

window.addEventListener('stx:load', scheduleAnalyticsRender)
document.addEventListener('stx:load', scheduleAnalyticsRender)
