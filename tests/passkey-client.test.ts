import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startAuthentication } from '@simplewebauthn/browser'
import { signInWithPasskey } from '../src/lib/passkeys'
import { lockSession, pageSession, queryClient } from '../src/lib/api'

vi.mock('@simplewebauthn/browser', () => ({ startAuthentication: vi.fn(), startRegistration: vi.fn(), browserSupportsWebAuthn: () => true }))
beforeEach(() => {
  pageSession.clear(); pageSession.setRequireEntryVerification(true); queryClient.clear(); vi.mocked(startAuthentication).mockReset()
  vi.stubGlobal('navigator', { sendBeacon: vi.fn(() => true) })
  vi.stubGlobal('document', { visibilityState: 'visible' })
})
afterEach(() => { pageSession.clear(); queryClient.clear(); vi.unstubAllGlobals() })
describe('client Passkey verification', () => {
  it('uses the same verified login flow for an automatic prompt and establishes its page token', async () => {
    const credential = { id: 'test-credential' }
    vi.mocked(startAuthentication).mockResolvedValue(credential as Awaited<ReturnType<typeof startAuthentication>>)
    const fetch = vi.fn(async (url: string, _init?: RequestInit) => Response.json(url.endsWith('/options') ? { challenge: 'test-challenge' } : { pageToken: 'a'.repeat(64) }))
    vi.stubGlobal('fetch', fetch)
    await signInWithPasskey()
    expect(startAuthentication).toHaveBeenCalledOnce()
    expect(JSON.parse(fetch.mock.calls[1][1]!.body as string)).toEqual(credential)
    expect(pageSession.unlocked).toBe(true); expect(pageSession.verifying).toBe(false)
  })
  it('leaves a cancelled prompt locked and permits a later manual retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ challenge: 'test-challenge', pageToken: 'b'.repeat(64) })))
    vi.mocked(startAuthentication).mockRejectedValueOnce(new DOMException('Cancelled', 'NotAllowedError'))
    await expect(signInWithPasskey()).rejects.toMatchObject({ name: 'NotAllowedError' })
    expect(pageSession.unlocked).toBe(false); expect(pageSession.verifying).toBe(false)
    vi.mocked(startAuthentication).mockResolvedValueOnce({} as Awaited<ReturnType<typeof startAuthentication>>)
    await signInWithPasskey()
    expect(pageSession.unlocked).toBe(true)
  })
  it('does not open a credential sheet if the page becomes hidden while fetching its challenge', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { vi.stubGlobal('document', { visibilityState: 'hidden' }); return Response.json({ challenge: 'test-challenge' }) }))
    await expect(signInWithPasskey()).rejects.toMatchObject({ name: 'AbortError' })
    expect(startAuthentication).not.toHaveBeenCalled()
    expect(pageSession.unlocked).toBe(false); expect(pageSession.verifying).toBe(false)
  })
  it('does not open a delayed prompt after the page locks', async () => {
    let complete!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { complete = resolve })))
    const pending = signInWithPasskey()
    lockSession(); complete(Response.json({ challenge: 'test-challenge' }))
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(startAuthentication).not.toHaveBeenCalled()
    expect(pageSession.unlocked).toBe(false)
  })
})
