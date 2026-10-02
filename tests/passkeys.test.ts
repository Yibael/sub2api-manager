import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceStore } from '../server/workspace'
import { Passkeys } from '../server/passkeys'
import { createApp } from '../server/app'
import { authenticator } from './fixtures/authenticator'

const origin = 'https://manager.example'
afterEach(() => vi.useRealTimers())
async function setup() {
  const store = WorkspaceStore.memory(), service = new Passkeys(store, origin, 'test')
  const device = authenticator()
  const registration = await service.registrationOptions('session-a', 'Laptop')
  await service.register(registration.challengeId, 'session-a', device.register(registration.options))
  return { store, service, device }
}
describe('real WebAuthn verification', () => {
  it('registers a public key, verifies a signed assertion and rejects challenge replay', async () => {
    const { store, service, device } = await setup()
    const login = await service.authenticationOptions()
    const response = device.authenticate(login.options, store.userHandle)
    expect(await service.authenticate(login.challengeId, response)).toBe(device.id)
    expect(store.credentials()[0].counter).toBe(1)
    expect(store.summaries()[0].lastUsedAt).toBeTypeOf('number')
    expect(store.summaries()[0]).not.toHaveProperty('publicKey')
    await expect(service.authenticate(login.challengeId, response)).rejects.toThrow('过期')
  })
  it('rejects wrong origin, user handle and tampered signature', async () => {
    const { store, service, device } = await setup()
    const wrongOrigin = await service.authenticationOptions()
    await expect(service.authenticate(wrongOrigin.challengeId, device.authenticate(wrongOrigin.options, store.userHandle, 1, 'https://evil.example'))).rejects.toThrow('验证失败')
    const wrongUser = await service.authenticationOptions()
    await expect(service.authenticate(wrongUser.challengeId, device.authenticate(wrongUser.options, 'wrong-user'))).rejects.toThrow('验证失败')
    const tampered = await service.authenticationOptions()
    const response = device.authenticate(tampered.options, store.userHandle)
    response.response.signature = Buffer.alloc(72).toString('base64url')
    await expect(service.authenticate(tampered.challengeId, response)).rejects.toThrow('验证失败')
  })
  it('binds registration to its authenticated session and expires challenges', async () => {
    const store = WorkspaceStore.memory(), service = new Passkeys(store, origin, 'test'), device = authenticator()
    const first = await service.registrationOptions('session-a', 'test')
    await expect(service.register(first.challengeId, 'session-b', device.register(first.options))).rejects.toThrow('过期')
    const expired = await service.registrationOptions('session-a', 'test')
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 120_001)
    await expect(service.register(expired.challengeId, 'session-a', device.register(expired.options))).rejects.toThrow('过期')
    expect(store.credentials()).toHaveLength(0)
  })
  it('rejects revoked credentials and counter rollback', async () => {
    const { store, service, device } = await setup()
    const one = await service.authenticationOptions()
    await service.authenticate(one.challengeId, device.authenticate(one.options, store.userHandle, 2))
    const older = await service.authenticationOptions()
    await expect(service.authenticate(older.challengeId, device.authenticate(older.options, store.userHandle, 1))).rejects.toThrow('验证失败')
    const revoked = await service.authenticationOptions()
    await store.removePasskey(device.id)
    await expect(service.authenticate(revoked.challengeId, device.authenticate(revoked.options, store.userHandle, 3))).rejects.toThrow('验证失败')
  })
})
describe('Passkey HTTP boundary', () => {
  it.each([true, false])('verifies real Passkey login, management and session revocation (entry verification: %s)', async requireEntryVerification => {
    const store = WorkspaceStore.memory(), app = createApp({ workspace: store, monitor: null, password: 'test-password-long-enough', origin, secureCookie: true, serverUrl: '', instanceName: 'test', instanceId: store.id, saveIntervals: async () => {} }).compile()
    if (!requireEntryVerification) await store.update(0, { requireEntryVerification: false })
    const call = (path: string, body?: unknown, cookie = '', requestOrigin = origin, pageToken = '') => app.handle(new Request(`${origin}/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { origin: requestOrigin, cookie, 'x-page-session': pageToken, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }))
    expect((await call('/passkeys')).status).toBe(401)
    expect((await call('/passkeys/register/options', { name: 'test' })).status).toBe(401)
    const password = await call('/login', { password: 'test-password-long-enough' })
    const session = password.headers.get('set-cookie')!.split(';')[0], pageToken = (await password.json()).pageToken
    expect((await call('/passkeys/register/options', { name: 'test' }, session, 'https://evil.example', pageToken)).status).toBe(403)
    const options = await call('/passkeys/register/options', { name: 'Laptop' }, session, origin, pageToken)
    const challenge = options.headers.get('set-cookie')!.split(';')[0]
    expect(options.headers.get('set-cookie')).toContain('HttpOnly')
    expect(options.headers.get('set-cookie')).toContain('Path=/api/passkeys')
    const device = authenticator()
    const registered = await call('/passkeys/register/verify', device.register(await options.json()), `${session}; ${challenge}`, origin, pageToken)
    expect(registered.status).toBe(200)
    const login = await call('/passkeys/login/options', {})
    const assertion = device.authenticate(await login.json(), store.userHandle)
    const signedIn = await call('/passkeys/login/verify', assertion, login.headers.get('set-cookie')!.split(';')[0])
    expect(signedIn.status).toBe(200)
    const cookies = signedIn.headers.getSetCookie()
    const newSession = cookies.find(value => value.startsWith('sub2manager_session='))!.split(';')[0], newPageToken = (await signedIn.json()).pageToken
    expect((await (await call('/config', undefined, newSession, origin, newPageToken)).json()).authenticated).toBe(true)
    expect((await (await call('/config', undefined, newSession)).json()).authenticated).toBe(!requireEntryVerification)
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 5 * 60_000 + 1)
    expect((await call('/passkeys/rename', { id: device.id, name: 'New name' }, newSession, origin, newPageToken)).status).toBe(200)
    expect((await call('/passkeys/remove', { id: device.id }, newSession, origin, newPageToken)).status).toBe(200)
    expect((await (await call('/config', undefined, newSession, origin, newPageToken)).json()).authenticated).toBe(false)
    expect((await (await call('/config', undefined, newSession)).json()).authenticated).toBe(false)
    expect((await (await call('/config')).json()).passkeyAvailable).toBe(false)
  })
})
