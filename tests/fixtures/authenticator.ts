import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { isoCBOR } from '@simplewebauthn/server/helpers'
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/server'

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest()
export function authenticator() {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = keys.publicKey.export({ format: 'jwk' })
  const credentialId = randomBytes(32), id = credentialId.toString('base64url')
  const cose = isoCBOR.encode(new Map<number, number | Uint8Array>([[1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(Buffer.from(jwk.x!, 'base64url'))], [-3, new Uint8Array(Buffer.from(jwk.y!, 'base64url'))]]))
  return {
    id,
    register(options: PublicKeyCredentialCreationOptionsJSON, origin = 'https://manager.example'): RegistrationResponseJSON {
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin }))
      const size = Buffer.alloc(2); size.writeUInt16BE(credentialId.length)
      const authData = Buffer.concat([hash(options.rp.id!), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), size, credentialId, Buffer.from(cose)])
      const attestationObject = isoCBOR.encode(new Map<string, string | Uint8Array | Map<string, string>>([['fmt', 'none'], ['attStmt', new Map()], ['authData', new Uint8Array(authData)]]))
      return { id, rawId: id, type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: clientDataJSON.toString('base64url'), attestationObject: Buffer.from(attestationObject).toString('base64url'), transports: ['internal'] } }
    },
    authenticate(options: PublicKeyCredentialRequestOptionsJSON, userHandle: string, counter = 1, origin = 'https://manager.example'): AuthenticationResponseJSON {
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin }))
      const count = Buffer.alloc(4); count.writeUInt32BE(counter)
      const authData = Buffer.concat([hash(options.rpId!), Buffer.from([0x05]), count])
      return { id, rawId: id, type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: clientDataJSON.toString('base64url'), authenticatorData: authData.toString('base64url'), signature: sign('sha256', Buffer.concat([authData, hash(clientDataJSON)]), keys.privateKey).toString('base64url'), userHandle } }
    },
  }
}
