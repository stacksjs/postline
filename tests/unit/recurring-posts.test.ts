import { expect, test } from 'bun:test'
import { nextRecurringAt } from '../../app/Support/Social/recurring-posts'

test('monthly repeats use the last day of short months without drifting', () => {
  const series = { startsAt: '2028-01-31 17:00:00', timezone: 'America/Los_Angeles', interval: 'monthly' } as const
  expect(nextRecurringAt(series, '2028-01-31 17:00:00')).toBe('2028-02-29 17:00:00')
  expect(nextRecurringAt(series, '2028-02-29 17:00:00')).toBe('2028-03-31 16:00:00')
  expect(nextRecurringAt(series, '2030-03-10 16:00:00')).toBe('2030-03-31 16:00:00')
})

test('weekly repeats keep the local clock time and skip a daylight-saving gap', () => {
  const series = { startsAt: '2026-03-01 10:30:00', timezone: 'America/Los_Angeles', interval: 'weekly' } as const
  expect(nextRecurringAt(series, '2026-03-01 10:30:00')).toBe('2026-03-15 09:30:00')
})

test('daily repeats use one instant when a clock hour repeats', () => {
  const series = { startsAt: '2026-10-31 08:30:00', timezone: 'America/Los_Angeles', interval: 'daily' } as const
  expect(nextRecurringAt(series, '2026-10-31 08:30:00')).toBe('2026-11-01 08:30:00')
  expect(nextRecurringAt(series, '2026-11-01 08:30:00')).toBe('2026-11-02 09:30:00')
})
