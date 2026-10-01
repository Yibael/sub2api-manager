import { startAuthentication, startRegistration, browserSupportsWebAuthn, type PublicKeyCredentialRequestOptionsJSON, type PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser'
import type { LoginResponse } from '../../shared/domain'
import { api, acceptLogin, lockSession } from './api'
import { pageSession } from './page-session'
export { browserSupportsWebAuthn }
export async function signInWithPasskey() {
  const flow = pageSession.beginVerification()
  let verified = false
  try {
    const optionsJSON = await api<PublicKeyCredentialRequestOptionsJSON>('/passkeys/login/options', {})
    pageSession.assertCurrent(flow.epoch)
    if (document.visibilityState !== 'visible') throw new DOMException('页面已锁定，请重新验证', 'AbortError')
    const response = await startAuthentication({ optionsJSON })
    pageSession.assertCurrent(flow.epoch)
    acceptLogin(await api<LoginResponse>('/passkeys/login/verify', response), flow.epoch)
    verified = true
  } finally { if (flow.finish(verified, document.visibilityState === 'visible')) lockSession() }
}
export async function addPasskey(name: string) {
  const flow = pageSession.beginVerification()
  let verified = false
  try {
    const optionsJSON = await api<PublicKeyCredentialCreationOptionsJSON>('/passkeys/register/options', { name })
    const response = await startRegistration({ optionsJSON })
    pageSession.assertCurrent(flow.epoch)
    await api('/passkeys/register/verify', response)
    verified = true
  } finally { if (flow.finish(verified, document.visibilityState === 'visible')) lockSession() }
}
export function passkeyMessage(error: unknown) {
  const value = error as Error
  return value.name === 'NotAllowedError' ? '验证已取消或超时，请重试' : value.message || '无法完成 Passkey 验证'
}
