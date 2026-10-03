import { expect, it } from 'vitest'
import { overviewTotals } from '../src/lib/overview'
import { normalizeAccount, normalizeToday } from '../server/normalize'
import type { Sample, TodayStats } from '../shared/domain'

const sample = <T>(data: T): Sample<T> => ({ data, updatedAt: 1, error: null })
const account = (id: number, platform = 'openai', type = 'oauth') => sample(normalizeAccount({ id, platform, type, current_concurrency: id, concurrency: 10 }))
const usage = (standardCost: number | null): Sample<TodayStats> => sample(normalizeToday({ standard_cost: standardCost, cost: 999, user_cost: 888, requests: 1, tokens: 1 }))

it('sums standard usage for all pinned providers and types without using billed cost', () => {
  expect(overviewTotals([1, 2, 3], { 1: account(1), 2: account(2, 'anthropic'), 3: account(3, 'openai', 'apikey'), 4: account(4) }, { 1: usage(0.1), 2: usage(0.2), 3: usage(0), 4: usage(100) }))
    .toEqual({ concurrency: 6, concurrencyLimit: 30, standardUsage: '0.3' })
})
it('does not present incomplete or failed samples as a complete total', () => {
  expect(overviewTotals([1, 2], { 1: account(1) }).concurrency).toBeNull()
  expect(overviewTotals([1, 2], undefined, { 1: usage(80) }).standardUsage).toBeNull()
  expect(overviewTotals([1, 2], undefined, { 1: usage(80), 2: { ...usage(90), error: '读取失败' } }).standardUsage).toBeNull()
  expect(overviewTotals([1], undefined, { 1: usage(null) }).standardUsage).toBeNull()
})
it('keeps zero values valid and missing capacity unknown', () => {
  const row = account(1)
  row.data!.currentConcurrency = 0
  row.data!.concurrency = null
  expect(overviewTotals([1], { 1: row }, { 1: usage(0) })).toEqual({ concurrency: 0, concurrencyLimit: null, standardUsage: '0' })
})
it('keeps empty scopes unknown', () => {
  expect(overviewTotals([])).toEqual({ concurrency: null, concurrencyLimit: null, standardUsage: null })
})
