import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SQLitePersistence } from '../server/sqlite'
import { Benefits } from '../server/benefits'
import { normalizeAccount, benefitSample } from '../server/normalize'
import type { ResetCardOperation } from '../shared/reset-card'

const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })
function database(scope = 'workspace-a|upstream-a') {
  const directory = mkdtempSync(join(tmpdir(), 'manager-sqlite-'))
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
  const path = join(directory, 'manager.sqlite')
  const open = (nextScope = scope) => { const store = new SQLitePersistence(path, nextScope); cleanups.push(() => { try { store.close() } catch {} }); return store }
  return { path, open }
}
describe('SQLite persistence across restart', () => {
  it('rehydrates a confirmed reset-card time only while Sub2API snapshots match, never reviving A→B→A', async () => {
    const { open } = database()
    const queriedAt = Math.floor(Date.now() / 1000) * 1000
    const reset = { available_count: 1, credits: [{ expires_at: new Date(queriedAt + 86400000).toISOString() }] }
    const credits = { has_credits: true, unlimited: false, balance: '1234567890.12345' }
    let raw = { id: 1, platform: 'openai', type: 'oauth', credentials: { token: 'PRIVATE' }, extra: {
      codex_reset_credit_snapshot: reset, codex_credits_snapshot: { credits, fetched_at: queriedAt / 1000 }, other_secret: 'PRIVATE' } }
    const account = async () => ({ data: normalizeAccount(raw), error: null, updatedAt: Date.now(), readStartedAt: Date.now() })
    const upstream = { async request() { return { fetched_at: queriedAt / 1000, rate_limit_reset_credits: reset, credits, cache_persisted: true, credits_cache_persisted: true } } }
    let store = open()
    const first = await new Benefits(upstream, account, store).readQuota(1, true)
    expect(first.resetCredits.updatedAt).toBe(queriedAt)
    store.close(); store = open()
    const resumed = new Benefits(upstream, account, store)
    expect((await resumed.readQuota(1)).resetCredits.updatedAt).toBe(queriedAt)
    raw = { ...raw, extra: { ...raw.extra, codex_reset_credit_snapshot: { available_count: 0, credits: [] } } }
    expect((await resumed.readQuota(1)).resetCredits.updatedAt).toBeNull()
    store.close(); store = open()
    raw = { ...raw, extra: { ...raw.extra, codex_reset_credit_snapshot: reset } }
    expect((await new Benefits(upstream, account, store).readQuota(1)).resetCredits.updatedAt).toBeNull()
    expect(JSON.stringify(store.benefit(1, 'resetCredits'))).not.toContain('PRIVATE')
    const newer = queriedAt + 1000
    raw = { ...raw, extra: { ...raw.extra, codex_credits_snapshot: { credits: { ...credits, balance: '0.125' }, fetched_at: newer / 1000 } } }
    const result = await new Benefits(upstream, account, store).readQuota(1)
    expect(result.credits.updatedAt).toBe(newer)
    expect(result.credits.data?.balance).toBe('0.125')
  })
  it('isolates workspaces, upstream instances, accounts and benefit kinds', () => {
    const { open } = database(), a = open()
    a.recordBenefit(1, 'resetCredits', benefitSample({ availableCount: 1, expiresAt: [] }, 1000), 'query', 2000)
    expect(a.benefit(2, 'resetCredits')).toBeNull()
    expect(a.benefit(1, 'credits')).toBeNull()
    expect(open('workspace-b|upstream-a').benefit(1, 'resetCredits')).toBeNull()
    expect(open('workspace-a|upstream-b').benefit(1, 'resetCredits')).toBeNull()
    expect(a.benefit(1, 'resetCredits')?.sample.updatedAt).toBe(1000)
  })
  it('atomically claims an operation once and restores interrupted operations as uncertain', () => {
    const { open } = database(), a = open(), b = open()
    const operation: ResetCardOperation = { id: 'a'.repeat(32), accountId: 1, state: 'executing', startedAt: 1000, finishedAt: null, message: '执行中', windowsReset: null }
    expect(a.claimOperation(operation)).toBe(true)
    expect(b.claimOperation(operation)).toBe(false)
    expect(b.claimOperation({ ...operation, id: 'b'.repeat(32) })).toBe(false)
    a.close(); b.close()
    const resumed = open()
    expect(resumed.latestOperation(1)?.state).toBe('uncertain')
    expect(resumed.claimOperation({ ...operation, id: 'c'.repeat(32) })).toBe(false)
    resumed.updateOperation({ ...resumed.latestOperation(1)!, state: 'reviewed' })
    expect(resumed.claimOperation({ ...operation, id: 'c'.repeat(32) })).toBe(true)
  })
})
