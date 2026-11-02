import assert from 'node:assert/strict'
import test from 'node:test'
import { pushPayload, remindUnpaidOrders } from '../server/push.js'

test('push payload carries the alert text and where to open', () => {
  const payload = JSON.parse(pushPayload({ id: 'n1', title: 'Order on the way', body: 'Your rider is 5 minutes away', link: '/account/orders/o1', type: 'DELIVERY' }))
  assert.equal(payload.title, 'Order on the way')
  assert.equal(payload.link, '/account/orders/o1')
  assert.equal(payload.tag, 'n1')
})

test('an unpaid order gets one friendly reminder, never two', async () => {
  const now = new Date('2026-11-02T12:00:00Z')
  const order = { id: 'o1', customerId: 'c1', paymentReminderAt: null, restaurant: { name: 'Naijadeltapot' }, customer: { firstName: 'Ejiro' } }
  const created = []
  const db = {
    order: {
      findMany: async () => (order.paymentReminderAt ? [] : [order]),
      updateMany: async () => { if (order.paymentReminderAt) return { count: 0 }; order.paymentReminderAt = now; return { count: 1 } },
    },
    notification: { create: async ({ data }) => { created.push(data); return data } },
  }
  await remindUnpaidOrders(db, { now })
  await remindUnpaidOrders(db, { now })
  assert.equal(created.length, 1)
  assert.match(created[0].body, /Naijadeltapot/)
  assert.equal(created[0].link, '/account/orders/o1')
})

import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from 'node:crypto'
import { encryptPayload, generateVapidKeys, sendPush, vapidAuthorization } from '../server/webPushCore.js'
const b64url = (buffer) => Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64url = (text) => Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

test('a phone can decrypt what DOORSTEP sends (RFC 8291 aes128gcm)', () => {
  const phone = createECDH('prime256v1'); phone.generateKeys()
  const auth = randomBytes(16)
  const message = JSON.stringify({ title: 'New order', body: 'Jollof x2 from Mama Put' })
  const encrypted = encryptPayload(message, { p256dh: b64url(phone.getPublicKey()), auth: b64url(auth) })
  const salt = encrypted.subarray(0, 16)
  const idLength = encrypted.readUInt8(20)
  const serverPublic = encrypted.subarray(21, 21 + idLength)
  const cipherText = encrypted.subarray(21 + idLength)
  const shared = phone.computeSecret(serverPublic)
  const ikm = Buffer.from(hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), phone.getPublicKey(), serverPublic]), 32))
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16))
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12))
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce)
  decipher.setAuthTag(cipherText.subarray(cipherText.length - 16))
  const plain = Buffer.concat([decipher.update(cipherText.subarray(0, cipherText.length - 16)), decipher.final()])
  assert.equal(plain[plain.length - 1], 2)
  assert.equal(plain.subarray(0, -1).toString(), message)
})

test('the VAPID signature checks out with the public key', async () => {
  const keys = generateVapidKeys()
  const header = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', keys, 'mailto:test@example.com')
  const [, token, key] = header.match(/^vapid t=([^,]+), k=(.+)$/)
  assert.equal(key, keys.publicKey)
  const [h, c, s] = token.split('.')
  assert.equal(JSON.parse(fromB64url(c).toString()).aud, 'https://fcm.googleapis.com')
  const point = fromB64url(keys.publicKey)
  const publicKey = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64url(point.subarray(1, 33)), y: b64url(point.subarray(33, 65)) }, format: 'jwk' })
  assert.equal(verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, fromB64url(s)), true)
  const phone = createECDH('prime256v1'); phone.generateKeys()
  let sentTo = null
  await sendPush({ endpoint: 'https://push.example/1', keys: { p256dh: b64url(phone.getPublicKey()), auth: b64url(randomBytes(16)) } }, 'hi', { keys, contact: 'mailto:a@b.c', fetchImpl: async (url, init) => { sentTo = { url, init }; return { ok: true, status: 201 } } })
  assert.equal(sentTo.init.headers['Content-Encoding'], 'aes128gcm')
  await assert.rejects(sendPush({ endpoint: 'https://push.example/1', keys: { p256dh: b64url(phone.getPublicKey()), auth: b64url(randomBytes(16)) } }, 'hi', { keys, contact: 'mailto:a@b.c', fetchImpl: async () => ({ ok: false, status: 410 }) }), (error) => error.statusCode === 410)
})
