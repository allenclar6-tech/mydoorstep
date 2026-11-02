// Minimal Web Push sender built on Node's own crypto (RFC 8291 message encryption + RFC 8292 VAPID), so no extra
// package is needed. Works with Chrome, Edge, Firefox and Safari push services.
import { createECDH, createPrivateKey, createCipheriv, hkdfSync, randomBytes, sign } from 'node:crypto'

const b64url = (buffer) => Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64url = (text) => Buffer.from(String(text).replace(/-/g, '+').replace(/_/g, '/'), 'base64')

/** New VAPID key pair: { publicKey, privateKey } as base64url (65-byte uncompressed point, 32-byte secret). */
export function generateVapidKeys() {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(ecdh.getPrivateKey()) }
}

function vapidPrivateKey({ publicKey, privateKey }) {
  const point = fromB64url(publicKey)
  return createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: b64url(fromB64url(privateKey)), x: b64url(point.subarray(1, 33)), y: b64url(point.subarray(33, 65)) }, format: 'jwk' })
}

/** VAPID Authorization header for one push service. */
export function vapidAuthorization(endpoint, keys, contact, now = Date.now()) {
  const audience = new URL(endpoint).origin
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
  const claims = b64url(JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + 12 * 3600, sub: contact }))
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key: vapidPrivateKey(keys), dsaEncoding: 'ieee-p1363' })
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${keys.publicKey}`
}

/** Encrypts a payload for one subscription (aes128gcm content coding). */
export function encryptPayload(payload, { p256dh, auth }, { salt = randomBytes(16), serverEcdh } = {}) {
  const receiverPublic = fromB64url(p256dh)
  const authSecret = fromB64url(auth)
  const ecdh = serverEcdh || createECDH('prime256v1')
  if (!serverEcdh) ecdh.generateKeys()
  const serverPublic = ecdh.getPublicKey()
  const shared = ecdh.computeSecret(receiverPublic)
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), receiverPublic, serverPublic])
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32))
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16))
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12))
  const cipher = createCipheriv('aes-128-gcm', cek, nonce)
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()])
  const header = Buffer.alloc(21)
  salt.copy(header, 0)
  header.writeUInt32BE(4096, 16)
  header.writeUInt8(serverPublic.length, 20)
  return Buffer.concat([header, serverPublic, body])
}

/** Sends one push. Throws an error with statusCode when the push service refuses (404/410 = subscription gone). */
export async function sendPush(subscription, payload, { keys, contact, ttl = 3600, urgency = 'normal', fetchImpl = globalThis.fetch } = {}) {
  const body = encryptPayload(payload, subscription.keys)
  const response = await fetchImpl(subscription.endpoint, {
    method: 'POST',
    headers: { Authorization: vapidAuthorization(subscription.endpoint, keys, contact), TTL: String(ttl), Urgency: urgency, 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', 'Content-Length': String(body.length) },
    body,
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw Object.assign(new Error(`Push service answered ${response.status}`), { statusCode: response.status })
  return response.status
}
