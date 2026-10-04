import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../server/app'
import { Monitor } from '../server/monitor'
import { normalizeAccount, normalizeAutoReset } from '../server/normalize'
import { autoResetRequestSchema, formatResetThreshold } from '../shared/auto-reset'
import { defaultIntervals } from '../shared/domain'
import type { Upstream } from '../server/upstream'

afterEach(() => vi.useRealTimers())
function setup() {
  let raw: Record<string, unknown> = { id: 1, name: '主力账号', platform: 'openai', type: 'oauth', status: 'active', schedulable: true,
    credentials: { access_token: 'SECRET' }, extra: { auto_reset_credit_enabled: false, auto_reset_credit_5h_threshold: 0.875,
      auto_reset_credit_7d_threshold: '0.95', auto_pause_5h_threshold: 0.8, unrelated: { private: 'SECRET' },
      codex_reset_credit_snapshot: { available_count: 2 }, codex_auto_reset_credit_state: { status: 'available', attempt_credit_hash: 'PRIVATE' } } }
  const request = vi.fn<Upstream['request']>(async (path, options) => {
    if (path === 'accounts') return { total: 1, items: [structuredClone(raw)] }
    if (path !== 'accounts/1') throw new Error('Unexpected request')
    if (options?.method === 'PUT') {
      const next = (options.body as { extra: Record<string, unknown> }).extra
      // Match Sub2API: replace extra while retaining managed automatic state.
      raw = { ...raw, extra: { ...next, codex_auto_reset_credit_state: (raw.extra as Record<string, unknown>).codex_auto_reset_credit_state } }
    }
    return structuredClone(raw)
  })
  const monitor = new Monitor({ request }, { ...defaultIntervals }, 'UTC')
  return { request, monitor, manager: monitor.accountAutoReset, raw: () => raw,
    change: (updates: Record<string, unknown>) => { raw = { ...raw, ...updates } },
    extra: (updates: Record<string, unknown>) => { raw = { ...raw, extra: { ...(raw.extra as Record<string, unknown>), ...updates } } } }
}
const writes = (request: ReturnType<typeof setup>['request']) => request.mock.calls.filter(([, options]) => options?.method === 'PUT')

describe('automatic reset configuration initialization', () => {
  it('initializes from Sub2API settings and shares account reads without querying quota or referrals', async () => {
    const { monitor, request, extra } = setup()
    extra({ auto_reset_credit_enabled: true, auto_reset_credit_5h_threshold: 0.8 })
    const [detail, configs] = await Promise.all([monitor.details([1]), Promise.all(Array.from({ length: 20 }, () => monitor.autoResetConfig(1)))])
    expect(configs[0].data).toEqual({ enabled: true, threshold5h: 0.8, threshold7d: 0.95 })
    expect(configs[0].updatedAt).toBe(detail[1].updatedAt)
    expect(configs[0].error).toBeNull()
    expect(request.mock.calls.map(([path]) => path)).toEqual(['accounts/1'])
    expect(JSON.stringify(configs)).not.toMatch(/SECRET|PRIVATE|credentials|unrelated|benefits/)
  })

  it('keeps initialization failures unknown instead of defaulting the switch to off', async () => {
    const { monitor, request } = setup()
    request.mockRejectedValue(new Error('Sub2API 暂不可用'))
    expect(await monitor.autoResetConfig(1)).toEqual({ data: null, updatedAt: null, error: 'Sub2API 暂不可用' })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('preserves the last confirmed setting with an error when a later read fails', async () => {
    vi.useFakeTimers()
    const { monitor, request, extra } = setup()
    extra({ auto_reset_credit_enabled: true })
    const first = await monitor.autoResetConfig(1)
    request.mockRejectedValue(new Error('读取失败'))
    vi.advanceTimersByTime(defaultIntervals.status * 1000)
    const failed = await monitor.autoResetConfig(1)
    expect(failed.data).toEqual(first.data)
    expect(failed.data?.enabled).toBe(true)
    expect(failed.updatedAt).toBe(first.updatedAt)
    expect(failed.error).toBe('读取失败')
  })
})

describe('automatic reset card configuration', () => {
  it('resolves Sub2API defaults, ratio thresholds, legacy switches and eligible parent accounts', () => {
    const base = { platform: 'openai', type: 'oauth' }
    expect(normalizeAutoReset(base)).toEqual({ enabled: false, threshold5h: 1, threshold7d: 1 })
    for (const enabled of [true, 1, -1, '1', 't', 'T', 'TRUE', 'true', ' True ']) {
      expect(normalizeAutoReset({ ...base, extra: { auto_reset_credit_enabled: enabled } })?.enabled).toBe(true)
    }
    for (const enabled of [false, 0, 'false', '0', 'yes', null]) {
      expect(normalizeAutoReset({ ...base, extra: { auto_reset_credit_enabled: enabled } })?.enabled).toBe(false)
    }
    expect(normalizeAutoReset({ ...base, extra: { auto_reset_credit_5h_threshold: '0.001', auto_reset_credit_7d_threshold: 0.875 } })).toEqual({ enabled: false, threshold5h: 0.001, threshold7d: 0.875 })
    expect(formatResetThreshold(0.001)).toBe('0.1%')
    expect(formatResetThreshold(0.875)).toBe('87.5%')
    expect(normalizeAutoReset({ ...base, extra: { auto_reset_credit_5h_threshold: 90, auto_reset_credit_7d_threshold: -1 } })?.threshold5h).toBe(1)
    expect(normalizeAutoReset({ ...base, parent_account_id: 10 })).toBeNull()
    expect(normalizeAutoReset({ ...base, type: 'apikey' })).toBeNull()
    expect(autoResetRequestSchema.safeParse({ enabled: true, threshold5h: 0.5 }).success).toBe(false)
  })
  it('reads current settings without querying quota and previews without writing or exposing extra', async () => {
    const { manager, monitor, request, extra } = setup()
    expect((await monitor.details([1]))[1].data?.autoReset?.enabled).toBe(false)
    extra({ auto_reset_credit_5h_threshold: 0.9 })
    const preview = await manager.prepare(1, true, 'owner')
    expect(preview.current.threshold5h).toBe(0.9)
    expect(preview.current.threshold7d).toBe(0.95)
    expect(writes(request)).toHaveLength(0)
    expect(request.mock.calls.every(([path]) => path === 'accounts/1')).toBe(true)
    expect(JSON.stringify(preview)).not.toMatch(/SECRET|PRIVATE|credentials|auto_pause|attempt_credit/)
  })
  it('toggles the switch once, preserves fresh extra and thresholds, and returns safe saved account data', async () => {
    const { manager, monitor, request, extra } = setup()
    await monitor.details([1]); await monitor.accounts()
    const preview = await manager.prepare(1, true, 'owner')
    extra({ newly_added: 'preserve', codex_credits_snapshot: { credits: { has_credits: true, unlimited: false, balance: '1000' }, fetched_at: 1791000000 } })
    const saved = await manager.confirm(1, preview.token, 'owner')
    expect(saved.autoReset).toEqual({ enabled: true, threshold5h: 0.875, threshold7d: 0.95 })
    const body = writes(request)[0][1]?.body as { extra: Record<string, unknown> }
    expect(Object.keys(body)).toEqual(['extra'])
    expect(body.extra).toMatchObject({ auto_reset_credit_enabled: true, auto_reset_credit_5h_threshold: 0.875, auto_reset_credit_7d_threshold: '0.95',
      auto_pause_5h_threshold: 0.8, newly_added: 'preserve', unrelated: { private: 'SECRET' }, codex_reset_credit_snapshot: { available_count: 2 } })
    expect(body.extra).not.toHaveProperty('codex_auto_reset_credit_state')
    expect(saved.benefits?.credits.data?.balance).toBe('1000')
    expect(JSON.stringify(saved)).not.toMatch(/SECRET|PRIVATE|credentials|unrelated|newly_added/)
    expect((await monitor.details([1]))[1].data?.autoReset?.enabled).toBe(true)
    expect((await monitor.accounts()).data?.[0].autoReset?.enabled).toBe(true)
    await expect(manager.confirm(1, preview.token, 'owner')).rejects.toMatchObject({ status: 409 })
    const disable = await manager.prepare(1, false, 'owner')
    expect((await manager.confirm(1, disable.token, 'owner')).autoReset?.enabled).toBe(false)
    expect(writes(request)).toHaveLength(2)
  })
  it('binds confirmation to the account and session, and rejects cancelled, expired and superseded confirmations', async () => {
    vi.useFakeTimers()
    const { manager, request } = setup()
    const first = await manager.prepare(1, true, 'owner')
    await expect(manager.confirm(1, first.token, 'another')).rejects.toMatchObject({ status: 409 })
    await expect(manager.confirm(2, first.token, 'owner')).rejects.toMatchObject({ status: 409 })
    const next = await manager.prepare(1, true, 'owner')
    await expect(manager.confirm(1, first.token, 'owner')).rejects.toMatchObject({ status: 409 })
    manager.cancel(1, next.token, 'owner')
    await expect(manager.confirm(1, next.token, 'owner')).rejects.toMatchObject({ status: 409 })
    const expired = await manager.prepare(1, true, 'owner')
    vi.advanceTimersByTime(120_001)
    await expect(manager.confirm(1, expired.token, 'owner')).rejects.toMatchObject({ status: 409 })
    expect(writes(request)).toHaveLength(0)
  })
  it('rejects unsupported accounts, unchanged switches and invalid stored thresholds before writing', async () => {
    const { manager, request, change, extra } = setup()
    await expect(manager.prepare(1, false, 'owner')).rejects.toThrow('未发生变化')
    extra({ auto_reset_credit_5h_threshold: null })
    await expect(manager.prepare(1, true, 'owner')).rejects.toThrow('阈值无效')
    extra({ auto_reset_credit_5h_threshold: 0.875 })
    change({ parent_account_id: 10 })
    await expect(manager.prepare(1, true, 'owner')).rejects.toThrow('母账号')
    change({ parent_account_id: null, type: 'apikey' })
    await expect(manager.prepare(1, true, 'owner')).rejects.toThrow('母账号')
    expect(writes(request)).toHaveLength(0)
  })
  it('rechecks the confirmed settings and rejects a concurrent threshold change', async () => {
    const { manager, request, extra } = setup()
    const preview = await manager.prepare(1, true, 'owner')
    extra({ auto_reset_credit_7d_threshold: 0.9 })
    await expect(manager.confirm(1, preview.token, 'owner')).rejects.toThrow('已被修改')
    expect(writes(request)).toHaveLength(0)
  })
  it('does not retry an uncertain write, consumes the token, and invalidates old account snapshots', async () => {
    const { monitor, manager, request, extra } = setup()
    await monitor.details([1])
    const preview = await manager.prepare(1, true, 'owner')
    request.mockImplementationOnce(async () => structuredClone(setup().raw()))
    request.mockImplementationOnce(async () => { extra({ auto_reset_credit_enabled: true }); throw new Error('网络中断') })
    await expect(manager.confirm(1, preview.token, 'owner')).rejects.toThrow('网络中断')
    await expect(manager.confirm(1, preview.token, 'owner')).rejects.toMatchObject({ status: 409 })
    expect(writes(request)).toHaveLength(1)
    expect((await monitor.details([1]))[1].data?.autoReset?.enabled).toBe(true)
  })
  it('serializes writes and prevents old detail or directory responses from restoring the previous switch', async () => {
    const { manager, monitor, request } = setup()
    const initial = request.getMockImplementation()!
    let releaseStatus!: () => void, releaseDirectory!: () => void
    let holdStatus = true, holdDirectory = true
    request.mockImplementation(async (path, options) => {
      const raw = await initial(path, options)
      if (path === 'accounts/1' && !options?.method && holdStatus) { holdStatus = false; await new Promise<void>(resolve => { releaseStatus = resolve }) }
      if (path === 'accounts' && holdDirectory) { holdDirectory = false; await new Promise<void>(resolve => { releaseDirectory = resolve }) }
      return raw
    })
    const status = monitor.details([1]), directory = monitor.accounts()
    await vi.waitFor(() => expect(releaseStatus).toBeTypeOf('function'))
    const one = await manager.prepare(1, true, 'one'), two = await manager.prepare(1, true, 'two')
    const saving = manager.confirm(1, one.token, 'one')
    await expect(manager.confirm(1, two.token, 'two')).rejects.toThrow('正在保存')
    await saving
    releaseStatus(); releaseDirectory()
    expect((await status)[1].data?.autoReset?.enabled).toBe(true)
    expect((await directory).data?.[0].autoReset?.enabled).toBe(true)
    expect(writes(request)).toHaveLength(1)
  })
  it('fails verification when the upstream response does not contain the confirmed switch', async () => {
    const { manager, request } = setup()
    const preview = await manager.prepare(1, true, 'owner')
    request.mockImplementationOnce(async () => setup().raw())
    request.mockImplementationOnce(async () => setup().raw())
    await expect(manager.confirm(1, preview.token, 'owner')).rejects.toThrow('未能确认')
    expect(writes(request)).toHaveLength(1)
    expect(normalizeAccount(setup().raw()).autoReset?.enabled).toBe(false)
  })
})

describe('automatic reset configuration API', () => {
  it('requires authentication and same origin, accepts only a confirmed switch, and keeps thresholds read-only', async () => {
    const { monitor, request } = setup(), origin = 'https://manager.example'
    const app = createApp({ monitor, password: 'test-password-long-enough', origin, secureCookie: true,
      serverUrl: 'https://upstream.example', instanceName: 'test', instanceId: 'test', saveIntervals: async () => {} }).compile()
    const call = (path: string, body: unknown, session?: { cookie: string; token: string }, method = 'POST', from = origin) => app.handle(new Request(`${origin}/api${path}`, {
      method, headers: { origin: from, 'Content-Type': 'application/json', ...(session ? { cookie: session.cookie, 'x-page-session': session.token } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(body),
    }))
    expect((await call('/accounts/1/auto-reset', undefined, undefined, 'GET')).status).toBe(401)
    expect((await call('/accounts/1/auto-reset/preview', { enabled: true })).status).toBe(401)
    expect((await call('/accounts/1/auto-reset', { token: 'a'.repeat(64) }, undefined, 'PUT')).status).toBe(401)
    const login = await call('/login', { password: 'test-password-long-enough' })
    const session = { cookie: login.headers.get('set-cookie')!.split(';')[0], token: (await login.json()).pageToken }
    expect((await call('/accounts/1/auto-reset/preview', { enabled: true }, session, 'POST', 'https://other.example')).status).toBe(403)
    expect((await call('/accounts/0/auto-reset/preview', { enabled: true }, session)).status).toBe(422)
    expect((await call('/accounts/1/auto-reset/preview', { enabled: true, threshold5h: 0.5 }, session)).status).toBe(422)
    expect((await call('/accounts/1/auto-reset', { enabled: true }, session, 'PUT')).status).toBe(422)
    expect((await call('/accounts/1/auto-reset', { token: 'a'.repeat(64) }, session, 'PUT')).status).toBe(409)
    expect((await call('/accounts/0/auto-reset', undefined, session, 'GET')).status).toBe(422)
    expect(request).not.toHaveBeenCalled()
    const initialized = await call('/accounts/1/auto-reset', undefined, session, 'GET')
    expect(initialized.headers.get('cache-control')).toBe('no-store')
    const config = await initialized.json()
    expect(config.data).toEqual({ enabled: false, threshold5h: 0.875, threshold7d: 0.95 })
    expect(JSON.stringify(config)).not.toMatch(/SECRET|PRIVATE|credentials|unrelated/)
    expect(writes(request)).toHaveLength(0)
    const preview = await (await call('/accounts/1/auto-reset/preview', { enabled: true }, session)).json()
    expect(writes(request)).toHaveLength(0)
    expect((await call('/accounts/1/auto-reset', { token: preview.token, extra: {} }, session, 'PUT')).status).toBe(422)
    const saved = await call('/accounts/1/auto-reset', { token: preview.token }, session, 'PUT')
    expect(saved.status).toBe(200)
    expect((await saved.json()).autoReset.enabled).toBe(true)
    expect((await call('/accounts/1/auto-reset', { token: preview.token }, session, 'PUT')).status).toBe(409)
    expect(writes(request)).toHaveLength(1)
  })
})
