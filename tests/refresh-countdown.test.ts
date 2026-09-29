import { expect, it } from 'vitest'
import { refreshCountdown } from '../src/lib/refresh-countdown'

const channel = { enabled: true, interval: 5, dataUpdatedAt: 1000, errorUpdatedAt: 0, fetchStatus: 'idle' as const }

it('counts down to the next active refresh and clamps overdue values', () => {
  expect(refreshCountdown(1000, [channel])).toBe(5)
  expect(refreshCountdown(2400, [channel])).toBe(4)
  expect(refreshCountdown(7000, [channel])).toBe(0)
})
it('chooses the earliest deadline across independently refreshed channels', () => {
  expect(refreshCountdown(4000, [channel, { ...channel, interval: 15, dataUpdatedAt: 500 }, { ...channel, enabled: false, dataUpdatedAt: 0 }])).toBe(2)
  expect(refreshCountdown(5000, [{ ...channel, dataUpdatedAt: 5000 }, { ...channel, interval: 15, dataUpdatedAt: 1000 }])).toBe(5)
})
it('uses request completion after manual refresh or failure', () => {
  expect(refreshCountdown(10000, [{ ...channel, dataUpdatedAt: 9000 }])).toBe(4)
  expect(refreshCountdown(10000, [{ ...channel, errorUpdatedAt: 9000 }])).toBe(4)
})
it('hides countdown when refreshing, offline, inactive, or not yet loaded', () => {
  expect(refreshCountdown(2000, [{ ...channel, fetchStatus: 'fetching' }])).toBeNull()
  expect(refreshCountdown(2000, [{ ...channel, fetchStatus: 'paused' }])).toBeNull()
  expect(refreshCountdown(2000, [{ ...channel, enabled: false }])).toBeNull()
  expect(refreshCountdown(2000, [{ ...channel, dataUpdatedAt: 0 }])).toBeNull()
  expect(refreshCountdown(2000, [])).toBeNull()
})
it('does not exceed the configured interval when completion is newer than the clock tick', () => {
  expect(refreshCountdown(1000, [{ ...channel, dataUpdatedAt: 1600 }])).toBe(5)
})
