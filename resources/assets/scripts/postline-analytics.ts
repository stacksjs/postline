import { ticks } from '@ts-charts/array'
import { scaleLinear } from '@ts-charts/scale'
import { line } from '@ts-charts/shape'

type Point = {
  label: string
  value: number
  posts: number
}

const points: Point[] = [
  { label: 'Apr 16', value: 18, posts: 1 },
  { label: 'Apr 20', value: 24, posts: 2 },
  { label: 'Apr 24', value: 21, posts: 1 },
  { label: 'Apr 28', value: 35, posts: 3 },
  { label: 'May 2', value: 30, posts: 2 },
  { label: 'May 6', value: 42, posts: 3 },
  { label: 'May 10', value: 48, posts: 4 },
  { label: 'May 14', value: 57, posts: 4 },
]

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

  const maxValue = Math.max(...points.map(point => point.value))
  const x = scaleLinear()
    .domain([0, points.length - 1])
    .range([inset.left, width - inset.right])
  const y = scaleLinear()
    .domain([0, Math.ceil((maxValue + 8) / 10) * 10])
    .range([height - inset.bottom, inset.top])

  const generator = line<Point>()
    .x((_point: Point, index: number) => x(index))
    .y((point: Point) => y(point.value))

  const path = generator(points) || ''
  const baseline = height - inset.bottom
  const firstX = x(0)
  const lastX = x(points.length - 1)
  const areaPath = `${path}L${lastX},${baseline}L${firstX},${baseline}Z`
  const yTicks = ticks(0, Math.ceil((maxValue + 8) / 10) * 10, 4)
  const xTickIndexes = points.map((_point, index) => index).filter(index => index === 0 || index === points.length - 1 || index % 2 === 1)

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
      `<text x="${inset.left}" y="24" fill="${muted}" font-size="11" font-weight="700">Responses</text>`,
      `<text x="${width - inset.right}" y="${height - 14}" text-anchor="end" fill="${muted}" font-size="11" font-weight="700">Publishing date</text>`,
    ].join('')
  }

  const legend = chart.querySelector<SVGGElement>('[data-chart-legend]')
  if (legend) {
    legend.innerHTML = [
      `<circle cx="${width - 212}" cy="22" r="4" fill="${blue}"></circle>`,
      `<text x="${width - 202}" y="26" fill="${text}" font-size="11" font-weight="700">Response trend</text>`,
      `<rect x="${width - 82}" y="16" width="22" height="8" rx="4" fill="rgba(37, 99, 235, 0.12)"></rect>`,
      `<text x="${width - 28}" y="26" fill="${muted}" font-size="11" text-anchor="end">30 days</text>`,
    ].join('')
  }

  const pointLayer = chart.querySelector<SVGGElement>('[data-chart-points]')
  if (pointLayer) {
    pointLayer.innerHTML = points
      .map((point, index) => `<circle cx="${x(index)}" cy="${y(point.value)}" r="4" fill="#fff" stroke="${blue}" stroke-width="3"><title>${escapeHtml(point.label)}: ${point.value} responses from ${point.posts} posts</title></circle>`)
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
    const tooltipHeight = 62
    const tooltipX = Math.min(Math.max(xx + 14, inset.left), width - inset.right - tooltipWidth)
    const tooltipY = Math.max(inset.top + 8, yy - tooltipHeight - 14)

    if (hoverLayer) {
      hoverLayer.innerHTML = [
        `<line x1="${xx}" x2="${xx}" y1="${inset.top}" y2="${baseline}" stroke="${blue}" stroke-width="1.5" stroke-dasharray="4 4" opacity="0.55"></line>`,
        `<circle cx="${xx}" cy="${yy}" r="7" fill="#fff" stroke="${blue}" stroke-width="3"></circle>`,
        `<g transform="translate(${tooltipX} ${tooltipY})" data-chart-tooltip>`,
        `<rect width="${tooltipWidth}" height="${tooltipHeight}" rx="12" fill="#fff" stroke="#d4d4d8" stroke-width="1.2"></rect>`,
        `<text x="12" y="22" fill="${text}" font-size="12" font-weight="800">${escapeHtml(point.label)}</text>`,
        `<text x="12" y="40" fill="${muted}" font-size="11">${point.value} responses</text>`,
        `<text x="12" y="54" fill="${muted}" font-size="10">${point.posts} scheduled posts</text>`,
        '</g>',
      ].join('')
      hoverLayer.removeAttribute('aria-hidden')
    }

    if (hitArea)
      hitArea.setAttribute('aria-label', `${point.label}: ${point.value} responses from ${point.posts} scheduled posts`)
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

let renderFrame = 0

function scheduleAnalyticsRender(): void {
  if (renderFrame) return

  renderFrame = window.requestAnimationFrame(() => {
    renderFrame = 0
    renderAnalyticsChart()
  })
}

function watchAnalyticsChartMounts(): void {
  scheduleAnalyticsRender()

  const target = document.body || document.documentElement
  if (!target) return

  const observer = new MutationObserver(() => {
    if (document.querySelector('[data-analytics-chart]:not([data-rendered="true"])'))
      scheduleAnalyticsRender()
  })

  observer.observe(target, { childList: true, subtree: true })
}

if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', watchAnalyticsChartMounts, { once: true })
else
  watchAnalyticsChartMounts()

window.addEventListener('stx:load', scheduleAnalyticsRender)
document.addEventListener('stx:load', scheduleAnalyticsRender)
