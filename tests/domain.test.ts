import { describe, expect, it } from 'vitest'
import { accountState, dateInZone, subscriptionCycle } from '../shared/domain'
import { normalizeAccount, normalizeToday, normalizeUsage } from '../server/normalize'

describe('subscription calendar', () => {
  it('clamps short months and restores the original renewal day', () => {
    expect(subscriptionCycle('2026-02-28', 31)).toEqual({ start: '2026-02-28', end: '2026-03-30', next: '2026-03-31' })
    expect(subscriptionCycle('2026-03-31', 31)).toEqual({ start: '2026-03-31', end: '2026-04-29', next: '2026-04-30' })
    expect(subscriptionCycle('2028-02-29', 31).start).toBe('2028-02-29')
  })
  it('keeps inclusive displayed dates without overlapping adjacent cycles', () => {
    expect(subscriptionCycle('2026-09-14', 15)).toEqual({ start: '2026-08-15', end: '2026-09-14', next: '2026-09-15' })
    expect(subscriptionCycle('2026-09-15', 15).start).toBe('2026-09-15')
    expect(subscriptionCycle('2026-01-01', 15).start).toBe('2025-12-15')
  })
  it('uses the selected timezone across midnight and DST', () => {
    expect(dateInZone(new Date('2026-09-29T16:00:00Z'), 'Asia/Shanghai')).toBe('2026-09-30')
    expect(dateInZone(new Date('2026-03-08T07:59:00Z'), 'America/Los_Angeles')).toBe('2026-03-07')
  })
})
describe('safe upstream projection', () => {
  it('strips credentials and retains only supported local limits', () => {
    const raw = { id: 1, name: 'API', platform: 'openai', type: 'apikey', status: 'active', credentials: { access_token: 'secret' }, extra: { secret: 'private' }, quota_daily_limit: 10, quota_daily_used: 2, quota_weekly_limit: 0 }
    const account = normalizeAccount(raw)
    expect(account.supportsUsage).toBe(false)
    expect(account.localQuotas).toHaveLength(1)
    expect(account.localQuotas[0].percent).toBe(20)
    expect(JSON.stringify(account)).not.toMatch(/secret|private|credentials|access_token/)
  })
  it('keeps monetary metrics independent and missing values unknown', () => {
    expect(normalizeToday({ standard_cost: 0, cost: 5, user_cost: 9, tokens: -1, requests: 1.5 })).toEqual({ standardCost: '0', accountCost: '5', userCost: '9', tokens: null, requests: null })
    expect(normalizeToday({ cost: 5 }).standardCost).toBeNull()
  })
  it('only estimates OpenAI OAuth quota from the same seven-day sample', () => {
    const account = normalizeAccount({ id: 1, type: 'oauth', platform: 'openai' })
    const usage = { seven_day: { utilization: 25, window_stats: { cost: 10 } } }
    expect(normalizeUsage(usage, account).estimatedWeeklyCost).toBe('40')
    expect(normalizeUsage(usage, { ...account, platform: 'anthropic' }).estimatedWeeklyCost).toBeNull()
    expect(() => normalizeUsage({ error: 'PRIVATE UPSTREAM MESSAGE' }, account)).toThrow('额度暂不可用')
  })
  it('distinguishes API limits from OAuth capabilities and runtime state', () => {
    expect(normalizeAccount({ id: 1, platform: 'gemini', type: 'apikey' }).supportsUsage).toBe(true)
    const account = normalizeAccount({ id: 1, platform: 'anthropic', type: 'setup-token', status: 'active', rate_limit_reset_at: '2030-01-01T00:00:00Z' })
    expect(account.supportsUsage).toBe(true)
    expect(accountState(account, Date.parse('2026-09-29'))).toBe('限流中')
  })
})
