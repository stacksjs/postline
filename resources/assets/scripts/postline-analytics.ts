import { line, scaleLinear } from '@ts-charts/charts'

type Point = {
  label: string
  value: number
}

const points: Point[] = [
  { label: 'Apr 16', value: 18 },
  { label: 'Apr 20', value: 24 },
  { label: 'Apr 24', value: 21 },
  { label: 'Apr 28', value: 35 },
  { label: 'May 2', value: 30 },
  { label: 'May 6', value: 42 },
  { label: 'May 10', value: 48 },
  { label: 'May 14', value: 57 },
]

function renderAnalyticsChart(): void {
  const chart = document.querySelector<SVGSVGElement>('[data-analytics-chart]')
  if (!chart || chart.dataset.rendered === 'true') return

  const width = 640
  const height = 220
  const inset = { top: 24, right: 28, bottom: 34, left: 36 }
  const maxValue = Math.max(...points.map(point => point.value))
  const x = scaleLinear()
    .domain([0, points.length - 1])
    .range([inset.left, width - inset.right])
  const y = scaleLinear()
    .domain([0, maxValue + 8])
    .range([height - inset.bottom, inset.top])

  const generator = line<Point>()
    .x((_point: Point, index: number) => x(index))
    .y((point: Point) => y(point.value))

  const path = generator(points) || ''
  const baseline = height - inset.bottom
  const firstX = x(0)
  const lastX = x(points.length - 1)
  const areaPath = `${path}L${lastX},${baseline}L${firstX},${baseline}Z`
  const ticks = [0, Math.round(maxValue / 2), maxValue]

  chart.querySelector<SVGPathElement>('[data-chart-line]')?.setAttribute('d', path)
  chart.querySelector<SVGPathElement>('[data-chart-area]')?.setAttribute('d', areaPath)

  const grid = chart.querySelector<SVGGElement>('[data-chart-grid]')
  if (grid) {
    grid.innerHTML = ticks
      .map((tick) => {
        const yy = y(tick)
        return `<line x1="${inset.left}" x2="${width - inset.right}" y1="${yy}" y2="${yy}" stroke="#e4e4e7" stroke-width="1"></line>`
      })
      .join('')
  }

  const pointLayer = chart.querySelector<SVGGElement>('[data-chart-points]')
  if (pointLayer) {
    pointLayer.innerHTML = points
      .map((point, index) => `<circle cx="${x(index)}" cy="${y(point.value)}" r="4" fill="#fff" stroke="#2563eb" stroke-width="3"><title>${point.label}: ${point.value}</title></circle>`)
      .join('')
  }

  chart.dataset.rendered = 'true'
}

renderAnalyticsChart()
window.addEventListener('stx:load', renderAnalyticsChart)
