import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../server/app'
import { Monitor } from '../server/monitor'
import { normalizeAccount, normalizeBenefits, benefitSample } from '../server/normalize'
import { UpstreamError, type Upstream } from '../server/upstream'
import { availableResetCredits, formatCredits, type ResetCredits } from '../shared/benefits'
import { defaultIntervals } from '../shared/domain'

const now = Date.parse('2026-10-04T06:00:00Z')
const expires = ['2026-10-05T06:00:00Z', '2026-10-08T06:00:00Z']
const reset = { available_count: 2, credits: expires.map(expires_at => ({ expires_at })) }
const credits = { has_credits: true, unlimited: false, balance: '62500.125' }
const eligibility = { should_show: true, available_invites: 3, fetched_at: now / 1000 }
const extra = { codex_reset_credit_snapshot: reset, codex_credits_snapshot: { credits, fetched_at: now / 1000 }, codex_referral_snapshot: eligibility }
const quotaPath = 'openai/accounts/1/quota/refresh', referralPath = 'openai/accounts/1/referrals/refresh'

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now) })
afterEach(() => vi.useRealTimers())

function setup(override?: Upstream['request']) {
  let saved = { ...extra }
  const request = vi.fn<Upstream['request']>(async (path, options) => {
    if (override) {
      const value = await override(path, options)
      if (value !== undefined) return value
    }
    if (path === 'accounts/1') return { id: 1, platform: 'openai', type: 'oauth', extra: saved }
    if (path === quotaPath) {
      saved = { ...saved, codex_reset_credit_snapshot: { ...reset, available_count: 1, credits: reset.credits.slice(1) },
        codex_credits_snapshot: { credits: { ...credits, balance: '70000' }, fetched_at: Math.floor(Date.now() / 1000) } }
      return { fetched_at: Math.floor(Date.now() / 1000), rate_limit_reset_credits: saved.codex_reset_credit_snapshot,
        credits: saved.codex_credits_snapshot.credits, cache_persisted: true, credits_cache_persisted: true }
    }
    if (path === referralPath) {
      saved = { ...saved, codex_referral_snapshot: { ...eligibility, available_invites: 4, fetched_at: Math.floor(Date.now() / 1000) } }
      return { eligibility: saved.codex_referral_snapshot, cache_persisted: true }
    }
    throw new Error('Unexpected benefits request')
  })
  return { request, monitor: new Monitor({ request }, { ...defaultIntervals }, 'UTC') }
}

describe('account benefit snapshots and explicit queries', () => {
  it('reads snapshots through the shared account cache without querying the upstream provider', async () => {
    const { monitor, request } = setup()
    const responses = await Promise.all(Array.from({ length: 20 }, () => monitor.accountBenefits.read(1)))
    expect(request.mock.calls.map(([path]) => path)).toEqual(['accounts/1'])
    expect(responses[0].resetCredits.data?.availableCount).toBe(2)
    expect(responses[0].resetCredits.updatedAt).toBeNull()
    expect(responses[0].credits.data?.balance).toBe('62500.125')
    expect(responses[0].referrals.data?.availableInvites).toBe(3)
    vi.advanceTimersByTime(5000)
    await monitor.accountBenefits.read(1)
    expect(request.mock.calls.map(([path]) => path)).toEqual(['accounts/1', 'accounts/1'])
  })

  it('coalesces simultaneous force queries, then reads their persisted state without another provider call', async () => {
    const { monitor, request } = setup()
    await monitor.details([1])
    vi.advanceTimersByTime(1000)
    const results = await Promise.all(Array.from({ length: 20 }, () => monitor.accountBenefits.readQuota(1, true)))
    expect(request.mock.calls.filter(([path]) => path === quotaPath)).toHaveLength(1)
    expect(request.mock.calls.filter(([path]) => path === referralPath)).toHaveLength(0)
    expect((await monitor.accountBenefits.read(1)).referrals.data?.availableInvites).toBe(3)
    const invitations = await Promise.all(Array.from({ length: 20 }, () => monitor.accountBenefits.readReferrals(1, true)))
    expect(request.mock.calls.filter(([path]) => path === referralPath)).toHaveLength(1)
    expect(request.mock.calls.filter(([path]) => path !== 'accounts/1').every(([, options]) => options?.method === 'POST' && options.body === undefined)).toBe(true)
    expect(results[0].credits.data?.balance).toBe('70000')
    expect(results[0].resetCredits.data?.availableCount).toBe(1)
    expect(invitations[0].referrals.data?.availableInvites).toBe(4)
    expect((await monitor.accountBenefits.read(1)).credits.data?.balance).toBe('70000')
    vi.advanceTimersByTime(5000)
    const cached = await monitor.accountBenefits.read(1)
    expect(cached.credits.data?.balance).toBe('70000')
    expect(cached.resetCredits.data?.availableCount).toBe(1)
    expect(cached.resetCredits.updatedAt).toBe(results[0].resetCredits.updatedAt)
    expect(request.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(request).toHaveBeenCalledTimes(4)
  })

  it('lets the invitation query complete independently while the quota query is still running', async () => {
    let finishQuota!: (value: unknown) => void
    const { monitor, request } = setup(async path => path === quotaPath ? new Promise(resolve => { finishQuota = resolve }) : undefined)
    const quota = monitor.accountBenefits.readQuota(1, true)
    await vi.waitFor(() => expect(finishQuota).toBeTypeOf('function'))
    const referrals = await monitor.accountBenefits.readReferrals(1, true)
    expect(referrals.referrals.data?.availableInvites).toBe(4)
    expect(request.mock.calls.filter(([path]) => path === quotaPath)).toHaveLength(1)
    expect(request.mock.calls.filter(([path]) => path === referralPath)).toHaveLength(1)
    finishQuota({ fetched_at: now / 1000, rate_limit_reset_credits: reset, credits, cache_persisted: true, credits_cache_persisted: true })
    expect((await quota).credits.data?.balance).toBe('62500.125')
  })

  it('keeps three independent query times and never revives the reset time after the snapshot changes', async () => {
    let snapshot: unknown
    const { monitor } = setup(async path => path === 'accounts/1' && snapshot ? snapshot : undefined)
    const fresh = await monitor.accountBenefits.readQuota(1, true)
    const account = (resetSnapshot: unknown, fetched: number) => ({ id: 1, platform: 'openai', type: 'oauth', extra: {
      codex_reset_credit_snapshot: resetSnapshot,
      codex_credits_snapshot: { credits: { ...credits, balance: '80000' }, fetched_at: fetched },
      codex_referral_snapshot: { ...eligibility, available_invites: 5, fetched_at: fetched + 1 },
    } })
    snapshot = account({ available_count: 1, credits: reset.credits.slice(1) }, now / 1000 + 2)
    vi.advanceTimersByTime(5000)
    const unchanged = await monitor.accountBenefits.read(1)
    expect(unchanged.resetCredits.updatedAt).toBe(fresh.resetCredits.updatedAt)
    expect(unchanged.credits.updatedAt).toBe(now + 2000)
    expect(unchanged.referrals.updatedAt).toBe(now + 3000)
    snapshot = account({ available_count: 0 }, now / 1000 + 7)
    vi.advanceTimersByTime(5000)
    const changed = await monitor.accountBenefits.read(1)
    expect(changed.resetCredits.data?.availableCount).toBe(0)
    expect(changed.resetCredits.updatedAt).toBeNull()
    snapshot = account({ available_count: 1, credits: reset.credits.slice(1) }, now / 1000 + 12)
    vi.advanceTimersByTime(5000)
    expect((await monitor.accountBenefits.read(1)).resetCredits.updatedAt).toBeNull()
  })

  it('keeps the previous invitation data when its query fails, while showing fresh quota information', async () => {
    const { monitor, request } = setup(async path => { if (path === referralPath) throw new UpstreamError(503, '可邀请数量查询失败') })
    const result = await monitor.accountBenefits.readReferrals(1, true)
    expect(result.referrals.data?.availableInvites).toBe(3)
    expect(result.referrals.updatedAt).toBe(now)
    expect(result.referrals.error).toBe('可邀请数量查询失败')
    expect(request.mock.calls.filter(([path]) => path === quotaPath)).toHaveLength(0)
    const quota = await monitor.accountBenefits.readQuota(1, true)
    expect(quota.credits.data?.balance).toBe('70000')
    expect(quota.resetCredits.error).toBeNull()
  })

  it('retains a live result when persistence fails and clears a missing balance instead of showing an older value', async () => {
    const { monitor } = setup(async path => {
      if (path === quotaPath) return { fetched_at: Math.floor(Date.now() / 1000), rate_limit_reset_credits: { available_count: 0 },
        credits: null, cache_persisted: false, credits_cache_persisted: false }
    })
    vi.advanceTimersByTime(1000)
    const result = await monitor.accountBenefits.readQuota(1, true)
    expect(result.resetCredits.data?.availableCount).toBe(0)
    expect(result.credits.data).toBeNull()
    expect(result.credits.warning).toContain('未保存')
    vi.advanceTimersByTime(5000)
    const later = await monitor.accountBenefits.read(1)
    expect(later.credits.data).toBeNull()
    expect(later.resetCredits.data?.availableCount).toBe(0)
    expect(later.credits.updatedAt).toBe(now + 1000)
    expect(later.credits.warning).toBeTruthy()
  })

  it('preserves successful values and their timestamps after a failed force query and obeys failure backoff', async () => {
    let fail = false
    const { monitor, request } = setup(async path => {
      if (fail && path === quotaPath) throw new UpstreamError(429, '请稍后重试', Date.now() + 60_000)
    })
    const first = await monitor.accountBenefits.readQuota(1, true)
    fail = true
    vi.advanceTimersByTime(1000)
    const failed = await monitor.accountBenefits.readQuota(1, true)
    expect(failed.credits.data).toEqual(first.credits.data)
    expect(failed.credits.updatedAt).toBe(first.credits.updatedAt)
    expect(failed.credits.error).toBe('请稍后重试')
    vi.advanceTimersByTime(5000)
    await monitor.accountBenefits.readQuota(1, true)
    expect(request.mock.calls.filter(([path]) => path === quotaPath)).toHaveLength(2)
  })

  it('does not let an account read started during refresh overwrite the live result after it completes', async () => {
    let finishQuota!: (value: unknown) => void, finishAccount!: (value: unknown) => void
    let delayQuota = false, delayAccount = false
    const staleAccount = { id: 1, platform: 'openai', type: 'oauth', extra }
    const { monitor } = setup(async path => {
      if (delayQuota && path === quotaPath) return new Promise(resolve => { finishQuota = resolve })
      if (delayAccount && path === 'accounts/1') return new Promise(resolve => { finishAccount = resolve })
    })
    await monitor.details([1])
    delayQuota = true
    vi.advanceTimersByTime(1000)
    const forcing = monitor.accountBenefits.readQuota(1, true)
    await vi.waitFor(() => expect(finishQuota).toBeTypeOf('function'))
    vi.advanceTimersByTime(4000)
    delayAccount = true
    const ordinary = monitor.accountBenefits.read(1)
    await vi.waitFor(() => expect(finishAccount).toBeTypeOf('function'))
    vi.advanceTimersByTime(1000)
    finishQuota({ fetched_at: Math.floor(Math.floor(Date.now() / 1000)), rate_limit_reset_credits: { available_count: 0 }, credits: { ...credits, balance: '80000' }, cache_persisted: true, credits_cache_persisted: true })
    expect((await forcing).credits.data?.balance).toBe('80000')
    vi.advanceTimersByTime(1000)
    finishAccount(staleAccount)
    expect((await ordinary).credits.data?.balance).toBe('80000')
    expect((await monitor.accountBenefits.read(1)).resetCredits.data?.availableCount).toBe(0)
  })

  it('rejects unsupported accounts and reports unsupported refresh APIs without inventing values', async () => {
    const unsupported = setup(async path => path === 'accounts/1' ? { id: 1, platform: 'openai', type: 'apikey' } : undefined)
    await expect(unsupported.monitor.accountBenefits.readQuota(1, true)).rejects.toThrow('不支持')
    expect(unsupported.request).toHaveBeenCalledTimes(1)
    const missing = setup(async path => { if (path === quotaPath || path === referralPath) throw new UpstreamError(404, 'not found') })
    expect((await missing.monitor.accountBenefits.readQuota(1, true)).credits.error).toContain('不支持此权益刷新接口')
  })
})

describe('safe benefit values', () => {
  it('ages out expired cards, keeps duplicate expiry dates and leaves incomplete cached counts unknown', () => {
    const value = normalizeBenefits({ codex_reset_credit_snapshot: { available_count: 2, credits: [{ expires_at: expires[0] }, { expires_at: expires[0] }] } })
    expect(availableResetCredits(value.resetCredits, now)).toBe(2)
    expect(availableResetCredits(value.resetCredits, Date.parse(expires[0]))).toBe(0)
    const incomplete = normalizeBenefits({ codex_reset_credit_snapshot: { available_count: 2 } }).resetCredits
    expect(availableResetCredits(incomplete, now)).toBeNull()
    expect(availableResetCredits({ ...incomplete, updatedAt: now }, now)).toBe(2)
    expect(availableResetCredits(benefitSample<ResetCredits>(null), now)).toBeNull()
  })

  it('preserves credit precision, distinguishes unlimited and zero, and excludes unrelated fields', () => {
    const account = normalizeAccount({ id: 1, platform: 'openai', type: 'oauth', credentials: { access_token: 'SECRET' }, extra: {
      ...extra, private_token: 'SECRET', codex_referral_snapshot: { ...eligibility, email: 'PRIVATE EMAIL', program_id: 'PRIVATE PROGRAM' },
      codex_credits_snapshot: { credits: { ...credits, balance: '9007199254740993.12345' }, fetched_at: now / 1000 },
    } })
    expect(formatCredits(account.benefits!.credits.data)).toBe('9,007,199,254,740,993.12345')
    expect(formatCredits({ hasCredits: true, unlimited: true, balance: null })).toBe('不限')
    expect(formatCredits({ hasCredits: false, unlimited: false, balance: null })).toBe('0')
    expect(formatCredits({ hasCredits: true, unlimited: false, balance: null })).toBe('—')
    expect(formatCredits(null)).toBe('—')
    expect(JSON.stringify(account)).not.toMatch(/SECRET|PRIVATE|access_token|credentials|program_id/)
    expect(normalizeBenefits({}).referrals.data).toBeNull()
    expect(normalizeBenefits({ codex_referral_snapshot: { should_show: true, available_invites: -1 } }).referrals.data?.availableInvites).toBeNull()
    expect(normalizeBenefits({ codex_referral_snapshot: { should_show: false, available_invites: null } }).referrals.data?.availableInvites).toBe(0)
  })
})

describe('benefit API protection', () => {
  it('requires a session and origin, validates IDs and rejects any invitation or reset payload', async () => {
    const { monitor, request } = setup()
    const origin = 'https://manager.example'
    const app = createApp({ monitor, password: 'test-password-long-enough', origin, secureCookie: true,
      serverUrl: 'https://upstream.example', instanceName: 'test', instanceId: 'test', saveIntervals: async () => {} }).compile()
    const send = (path: string, method: string, body?: unknown, session?: { cookie: string; pageToken: string }, requestOrigin = origin) => app.handle(new Request(`${origin}/api${path}`, {
      method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json', origin: requestOrigin }), ...(session ? { cookie: session.cookie, 'x-page-session': session.pageToken } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }))
    expect((await send('/accounts/1/benefits', 'GET')).status).toBe(401)
    for (const channel of ['quota', 'referrals']) {
      expect((await send(`/accounts/1/benefits/${channel}`, 'GET')).status).toBe(401)
      expect((await send(`/accounts/1/benefits/${channel}`, 'POST', {})).status).toBe(401)
    }
    const login = await send('/login', 'POST', { password: 'test-password-long-enough' })
    const session = { cookie: login.headers.get('set-cookie')!.split(';')[0], pageToken: (await login.json()).pageToken }
    expect((await send('/accounts/0/benefits', 'GET', undefined, session)).status).toBe(422)
    for (const channel of ['quota', 'referrals']) {
      expect((await send(`/accounts/0/benefits/${channel}`, 'POST', {}, session)).status).toBe(422)
      expect((await send(`/accounts/1/benefits/${channel}`, 'POST', {}, session, 'https://evil.example')).status).toBe(403)
      expect((await send(`/accounts/1/benefits/${channel}`, 'POST', { email: 'other@example.test', reset: true }, session)).status).toBe(422)
    }
    expect(request).not.toHaveBeenCalled()
    const snapshot = await send('/accounts/1/benefits', 'GET', undefined, session)
    expect(snapshot.headers.get('cache-control')).toBe('no-store')
    expect((await snapshot.json()).credits.data.balance).toBe('62500.125')
    const quotaSnapshot = await send('/accounts/1/benefits/quota', 'GET', undefined, session)
    expect(quotaSnapshot.headers.get('cache-control')).toBe('no-store')
    expect(await quotaSnapshot.json()).not.toHaveProperty('referrals')
    const referralSnapshot = await send('/accounts/1/benefits/referrals', 'GET', undefined, session)
    expect(await referralSnapshot.json()).not.toHaveProperty('credits')
    expect(request.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0)
    expect((await send('/accounts/1/benefits', 'POST', {}, session)).status).toBe(404)
    expect((await send('/accounts/1/benefits/quota', 'POST', {}, session)).status).toBe(200)
    expect(request.mock.calls.filter(([, options]) => options?.method === 'POST').map(([path]) => path)).toEqual([quotaPath])
    expect((await send('/accounts/1/benefits/referrals', 'POST', {}, session)).status).toBe(200)
    expect(request.mock.calls.filter(([, options]) => options?.method === 'POST').map(([path]) => path)).toEqual([quotaPath, referralPath])
  })
})
