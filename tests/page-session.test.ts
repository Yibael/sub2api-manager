import { afterEach, describe, expect, it, vi } from 'vitest'
import { PageSession, bindPageLifecycle } from '../src/lib/page-session'
import { createApp } from '../server/app'
import { WorkspaceStore } from '../server/workspace'
const token = 'a'.repeat(64)
afterEach(() => vi.useRealTimers())
function lifecycle() {
  const session = new PageSession(), document = Object.assign(new EventTarget(), { visibilityState: 'visible' }), window = new EventTarget()
  const lock = vi.fn(() => { session.clear() })
  const cleanup = bindPageLifecycle(session, document, window, lock)
  session.activate(token, session.epoch)
  return { session, document, window, lock, cleanup }
}
describe('page verification lifecycle', () => {
  it('remains unlocked through long foreground use, navigation and ordinary focus changes', () => {
    vi.useFakeTimers()
    const { session, document, window, lock, cleanup } = lifecycle()
    vi.advanceTimersByTime(60 * 60_000)
    window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(session.unlocked).toBe(true); expect(lock).not.toHaveBeenCalled()
    cleanup()
  })
  it('locks on hidden/lock-screen transitions and does not unlock automatically on return', () => {
    const { session, document, lock, cleanup } = lifecycle()
    document.visibilityState = 'hidden'; document.dispatchEvent(new Event('visibilitychange'))
    expect(session.token).toBe(null); expect(session.unlocked).toBe(false); expect(lock).toHaveBeenCalledOnce()
    document.visibilityState = 'visible'; document.dispatchEvent(new Event('visibilitychange'))
    expect(session.unlocked).toBe(false)
    cleanup()
  })
  it('locks on close, freeze and restored browser history without cancelling other pages', () => {
    const { session, document, window, cleanup } = lifecycle(), other = new PageSession()
    other.activate('b'.repeat(64), other.epoch)
    window.dispatchEvent(new Event('pagehide')); expect(session.unlocked).toBe(false)
    session.activate(token, session.epoch)
    document.dispatchEvent(new Event('freeze')); expect(session.unlocked).toBe(false)
    session.activate(token, session.epoch)
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true })); expect(session.unlocked).toBe(false)
    expect(other.unlocked).toBe(true)
    expect(new PageSession().unlocked).toBe(false)
    cleanup()
  })
  it('rejects late authentication after lock and after a subsequent successful login', () => {
    const session = new PageSession(), oldEpoch = session.epoch
    session.clear()
    expect(() => session.activate(token, oldEpoch)).toThrow('页面已锁定')
    session.activate('b'.repeat(64), session.epoch)
    expect(() => session.activate(token, oldEpoch)).toThrow('页面已锁定')
    expect(session.token).toBe('b'.repeat(64))
  })
  it('conceals content during a system Passkey sheet and resumes only after successful verification', () => {
    const { session, document, lock, cleanup } = lifecycle(), flow = session.beginVerification()
    document.visibilityState = 'hidden'; document.dispatchEvent(new Event('visibilitychange'))
    expect(session.unlocked).toBe(false); expect(session.token).toBe(token); expect(lock).not.toHaveBeenCalled()
    document.visibilityState = 'visible'
    expect(flow.finish(true, true)).toBe(false); expect(session.unlocked).toBe(true)
    const cancelled = session.beginVerification()
    document.visibilityState = 'hidden'; document.dispatchEvent(new Event('visibilitychange'))
    document.visibilityState = 'visible'
    if (cancelled.finish(false, true)) lock()
    expect(session.token).toBe(null)
    cleanup()
  })
  it('always locks on close during a Passkey sheet and rejects its late result', () => {
    const { session, window, cleanup } = lifecycle(), flow = session.beginVerification()
    window.dispatchEvent(new Event('pagehide'))
    expect(() => session.activate(token, flow.epoch)).toThrow('页面已锁定')
    expect(flow.finish(true, true)).toBe(false)
    expect(session.unlocked).toBe(false)
    cleanup()
  })
})
describe('server page verification', () => {
  function setup() {
    const origin = 'https://manager.example', store = WorkspaceStore.memory()
    const app = createApp({ workspace: store, monitor: null, password: 'test-password-long-enough', origin, secureCookie: true, serverUrl: '', instanceName: 'test', instanceId: store.id, saveIntervals: async () => {} }).compile()
    const call = (path: string, body?: unknown, cookie = '', pageToken = '') => app.handle(new Request(`${origin}/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { origin, cookie, 'x-page-session': pageToken, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }))
    async function login(cookie = '') {
      const response = await call('/login', { password: 'test-password-long-enough' }, cookie)
      return { cookie: response.headers.getSetCookie().find(value => value.startsWith('sub2manager_session='))!.split(';')[0], pageToken: (await response.json()).pageToken }
    }
    return { call, login }
  }
  it('requires both the protected Cookie and matching in-memory page token', async () => {
    const { call, login } = setup(), session = await login()
    expect((await call('/workspace', undefined, session.cookie, session.pageToken)).status).toBe(200)
    expect((await call('/workspace', undefined, session.cookie)).status).toBe(401)
    expect((await call('/workspace', undefined, '', session.pageToken)).status).toBe(401)
    expect((await call('/workspace', undefined, session.cookie, token)).status).toBe(401)
    expect((await (await call('/config', undefined, session.cookie)).json()).authenticated).toBe(false)
  })
  it('revokes a locked page while ignoring a delayed lock from an older login', async () => {
    const { call, login } = setup(), old = await login(), current = await login(old.cookie)
    expect((await call('/lock', { pageToken: old.pageToken }, current.cookie)).status).toBe(200)
    expect((await call('/workspace', undefined, current.cookie, current.pageToken)).status).toBe(200)
    await call('/lock', { pageToken: current.pageToken }, current.cookie)
    expect((await call('/workspace', undefined, current.cookie, current.pageToken)).status).toBe(401)
    const reopened = await login(current.cookie)
    expect(reopened.pageToken).not.toBe(current.pageToken)
    expect((await call('/workspace', undefined, reopened.cookie, reopened.pageToken)).status).toBe(200)
  })
})
