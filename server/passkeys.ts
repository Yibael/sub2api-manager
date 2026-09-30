import { randomBytes } from 'node:crypto'
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse, type RegistrationResponseJSON, type AuthenticationResponseJSON } from '@simplewebauthn/server'
import type { WorkspaceStore } from './workspace'

type Challenge = { challenge: string; expires: number; session: string | null; name?: string }
export class PasskeyError extends Error { constructor(message = 'Passkey 验证失败，请重试', public status = 400) { super(message) } }
export class Passkeys {
  private challenges = new Map<string, Challenge>()
  readonly rpId: string
  constructor(private store: WorkspaceStore, private origin: string, private name: string) { this.rpId = new URL(origin).hostname }
  available() { return this.store.credentials().some(key => key.rpId === this.rpId) }
  private remember(challenge: string, session: string | null, name?: string) {
    for (const [id, value] of this.challenges) if (value.expires <= Date.now()) this.challenges.delete(id)
    if (this.challenges.size >= 128) throw new PasskeyError('验证请求过多，请稍后重试', 429)
    const id = randomBytes(32).toString('base64url')
    this.challenges.set(id, { challenge, expires: Date.now() + 120_000, session, name })
    return id
  }
  private consume(id: unknown, session: string | null): Challenge {
    if (typeof id !== 'string') throw new PasskeyError('验证已过期，请重试')
    const value = this.challenges.get(id)
    this.challenges.delete(id)
    if (!value || value.expires <= Date.now() || value.session !== session) throw new PasskeyError('验证已过期，请重试')
    return value
  }
  async registrationOptions(session: string, name: string) {
    const options = await generateRegistrationOptions({
      rpName: this.name, rpID: this.rpId, userName: 'workspace-owner', userDisplayName: this.name,
      userID: new Uint8Array(Buffer.from(this.store.userHandle, 'base64url')), attestationType: 'none',
      supportedAlgorithmIDs: [-7, -257],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      excludeCredentials: this.store.credentials().filter(key => key.rpId === this.rpId).map(({ id, transports }) => ({ id, transports })),
    })
    return { options, challengeId: this.remember(options.challenge, session, name) }
  }
  async register(id: unknown, session: string, response: RegistrationResponseJSON) {
    const challenge = this.consume(id, session)
    let result
    try { result = await verifyRegistrationResponse({ response, expectedChallenge: challenge.challenge, expectedOrigin: this.origin, expectedRPID: this.rpId, requireUserVerification: true, supportedAlgorithmIDs: [-7, -257] }) }
    catch { throw new PasskeyError() }
    if (!result.verified) throw new PasskeyError()
    const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo
    await this.store.addPasskey({ id: credential.id, name: challenge.name!, rpId: this.rpId,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'), counter: credential.counter,
      transports: credential.transports ?? [], deviceType: credentialDeviceType, backedUp: credentialBackedUp,
      createdAt: Date.now(), lastUsedAt: null })
  }
  async authenticationOptions() {
    if (!this.available()) throw new PasskeyError('此站点尚未添加 Passkey')
    const options = await generateAuthenticationOptions({ rpID: this.rpId, userVerification: 'required' })
    return { options, challengeId: this.remember(options.challenge, null) }
  }
  async authenticate(id: unknown, response: AuthenticationResponseJSON) {
    const challenge = this.consume(id, null)
    const key = this.store.credentials().find(key => key.id === response.id && key.rpId === this.rpId)
    if (!key || response.response.userHandle !== this.store.userHandle) throw new PasskeyError()
    let result
    try { result = await verifyAuthenticationResponse({ response, expectedChallenge: challenge.challenge, expectedOrigin: this.origin, expectedRPID: this.rpId,
      credential: { id: key.id, publicKey: new Uint8Array(Buffer.from(key.publicKey, 'base64url')), counter: key.counter, transports: key.transports }, requireUserVerification: true }) }
    catch { throw new PasskeyError() }
    if (!result.verified) throw new PasskeyError()
    await this.store.recordAuthentication(key.id, key.counter, result.authenticationInfo.newCounter, result.authenticationInfo.credentialBackedUp)
    return key.id
  }
}
