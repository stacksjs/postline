import type { EngagementCounts } from '../../../../app/Support/Social/engagement-analytics'
import Chart from '@stacksjs/charts'

interface Sample { average: number, count: number }
interface Point { label: string, value: number }

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
  windows: Array<{ hour: number, count: number }>
  posts: Array<{ id: number, title: string, publishedAt: string, targets: Array<{ id: number, provider: string, handle: string | null, counts: EngagementCounts }> }>
  page: number
  pageCount: number
}

export function engagementLabels(counts: EngagementCounts, likes = 'like', reactions = `${likes}s`): string {
  const fields = [
    [counts.likes, likes, reactions],
    [counts.reposts, 'repost', 'reposts'],
    [counts.replies, 'reply', 'replies'],
    [counts.quotes, 'quote', 'quotes'],
    [counts.views, 'view', 'views'],
    [counts.shares, 'share', 'shares'],
    [counts.reach, 'account reached', 'accounts reached'],
    [counts.saves, 'save', 'saves'],
  ] as const
  return fields.flatMap(([count, singular, plural]) => count === undefined ? [] : [`${count.toLocaleString()} ${count === 1 ? singular : plural}`]).join(' · ')
}

export function formatPostDate(value: string): string {
  const published = new Date(`${value.replace(' ', 'T')}Z`)
  return Number.isNaN(published.getTime()) ? 'Date unavailable' : published.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function formatWindow(hour: number): string {
  const clock = new Date(Date.UTC(2000, 0, 1, hour))
  return clock.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
}

export function formatSample(sample: Sample): string {
  return `${sample.average.toLocaleString(undefined, { maximumFractionDigits: 1 })} interactions per post across ${sample.count} posts`
}

export function drawPublishingChart(canvas: HTMLCanvasElement, series: Point[]): Chart {
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
        label: 'Posts published',
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
