import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WorkspaceStore } from '../server/workspace'
import { createApp } from '../server/app'

describe('persistent workspace', () => {
  it('migrates intervals and preserves identity, preferences and credentials after reload and key rotation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sub2api-workspace-test-'))
    try {
      await writeFile(join(directory, 'intervals.json'), JSON.stringify({ status: 10, quota: 60, spending: 30 }))
      const path = join(directory, 'workspace.json')
      const store = await WorkspaceStore.open(path, 'Asia/Shanghai', 'old-admin-key-id')
      await store.update(0, { pins: [2, 1], subscriptions: [{ accountId: 1, price: 120, renewalDay: 31 }], actualCurrency: '¥' })
      await store.addPasskey({ id: 'credential', name: 'Laptop', rpId: 'manager.example', publicKey: 'public-key', counter: 0, transports: ['internal'], deviceType: 'multiDevice', backedUp: true, createdAt: 1, lastUsedAt: null })
      const reopened = await WorkspaceStore.open(path, 'UTC', 'rotated-admin-key-id')
      expect(reopened.id).toBe(store.id)
      expect(reopened.userHandle).toBe(store.userHandle)
      expect(reopened.snapshot()).toEqual(store.snapshot())
      expect(reopened.credentials()).toEqual(store.credentials())
      expect(reopened.legacyInstanceIds).toEqual(['old-admin-key-id'])
      expect(reopened.snapshot().preferences.intervals.quota).toBe(60)
      expect((await stat(path)).mode & 0o777).toBe(0o600)
      expect(JSON.parse(await readFile(path, 'utf8'))).not.toHaveProperty('password')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('serializes concurrent writes and rejects stale revisions without losing the winning change', async () => {
    const store = WorkspaceStore.memory()
    const values = await Promise.allSettled([store.update(0, { pins: [1] }), store.update(0, { pins: [2] })])
    expect(values.filter(value => value.status === 'fulfilled')).toHaveLength(1)
    expect(store.snapshot().preferences.pins).toEqual([1])
    await store.update(1, { costCurrency: '¥' })
    expect(store.snapshot().preferences.pins).toEqual([1])
    expect(store.snapshot().preferences.costCurrency).toBe('¥')
  })
  it('requires authentication, rejects client-only fields and reports conflicts to another device', async () => {
    const store = WorkspaceStore.memory(), origin = 'https://manager.example'
    const app = createApp({ workspace: store, monitor: null, password: 'test-password-long-enough', origin, secureCookie: true, serverUrl: '', instanceName: 'test', instanceId: store.id, saveIntervals: async () => {} }).compile()
    const call = (body?: unknown, session?: { cookie: string; pageToken: string }) => app.handle(new Request(`${origin}/api/workspace`, { method: body ? 'PATCH' : 'GET', headers: { origin, ...(session ? { cookie: session.cookie, 'x-page-session': session.pageToken } : {}), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }))
    expect((await call()).status).toBe(401)
    const login = await app.handle(new Request(`${origin}/api/login`, { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test-password-long-enough' }) }))
    const session = { cookie: login.headers.get('set-cookie')!.split(';')[0], pageToken: (await login.json()).pageToken }
    expect((await call({ revision: 0, preferences: { theme: 'dark' } }, session)).status).toBe(422)
    expect((await call({ revision: 0, preferences: { pins: [1] } }, session)).status).toBe(200)
    expect((await call({ revision: 0, preferences: { pins: [2] } }, session)).status).toBe(409)
    expect((await (await call(undefined, session)).json()).preferences.pins).toEqual([1])
  })
})
