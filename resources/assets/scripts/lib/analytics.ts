import type { EngagementCounts } from '../../../../app/Support/Social/engagement-analytics'
import Chart from '@stacksjs/charts'

interface Sample { average: number, count: number }
interface Point { date?: string, label: string, value: number }

export interface AnalyticsPayload {
  totalPosts: number
  stats: {
    bestChannel: (Sample & { provider: string }) | null
    bestHour: (Sample & { hour: number }) | null
    engagement?: EngagementCounts & { countsByProvider: Array<EngagementCounts & { provider: string }> }
    minSample: number
  }
  series: Point[]
  channelMix: Array<{ provider: string, published: number, share: number }>
  xMetricsEnabled: boolean
  windows: Array<{ hour: number, count: number }>
  posts: Array<{ id: number, title: string, publishedAt: string, targets: Array<{ id: number, provider: string, handle: string | null, counts: EngagementCounts }> }>
  page: number
  pageCount: number
}

export function formatPostDate(value: string, locale?: string, unavailable = 'Date unavailable'): string {
  const iso = value.replace(' ', 'T')
  const timestamp = iso.length === 10 ? `${iso}T00:00:00Z` : /(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? iso : `${iso}Z`
  const published = new Date(timestamp)
  return Number.isNaN(published.getTime()) ? unavailable : published.toLocaleDateString(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function formatWindow(hour: number, locale?: string): string {
  const clock = new Date(Date.UTC(2000, 0, 1, hour))
  return clock.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
}

export function drawPublishingChart(canvas: HTMLCanvasElement, series: Point[], datasetLabel: string): Chart {
  const colors = getComputedStyle(canvas)
  const token = (name: string) => colors.getPropertyValue(name).trim()
  const ink = token('--ink')
  const body = token('--body')
  const line = token('--line')
  const info = token('--info')

  return new Chart(canvas, {
    type: 'line',
    data: {
      labels: series.map(point => point.label),
      datasets: [{
        label: datasetLabel,
        data: series.map(point => point.value),
        borderColor: info,
        backgroundColor: token('--info-soft'),
        borderWidth: 2,
        pointRadius: series.length <= 30 ? 2 : 0,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        x: { grid: { display: false }, ticks: { color: body, font: { size: 12 }, maxTicksLimit: 6 } },
        y: { beginAtZero: true, grid: { color: line }, ticks: { color: body, font: { size: 12 }, precision: 0 } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: token('--panel'), titleColor: ink, bodyColor: body, borderColor: line, borderWidth: 1 },
      },
    },
  })
}
