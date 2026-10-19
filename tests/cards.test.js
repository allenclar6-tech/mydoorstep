import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decryptToken, encryptToken, isExpired, publicCard, saveCardFromAuthorization } from '../server/cardService.js'
import { completeCardVerification } from '../server/cardRoutes.js'

process.env.NODE_ENV = 'test'
process.env.CARD_TOKEN_ENCRYPTION_KEY = 'test-only-card-token-key-0123456789abcdef'
process.env.PAYSTACK_SECRET_KEY = 'sk_test_unit'

const authorization = { authorization_code: 'AUTH_abc123', signature: 'SIG_1', reusable: true, last4: '4081', exp_month: '12', exp_year: '2030', brand: 'visa', bank: 'TEST BANK', channel: 'card' }

test('card tokens are encrypted at rest and tamper-evident', () => {
  const stored = encryptToken('AUTH_abc123')
  assert.doesNotMatch(stored, /AUTH_abc123/)
  assert.equal(decryptToken(stored), 'AUTH_abc123')
  const parts = stored.split(':'); parts[3] = Buffer.from('tampered').toString('base64')
  assert.throws(() => decryptToken(parts.join(':')), (error) => error.code === 'SAVED_CARD_UNREADABLE')
})

test('only reusable card authorizations are saved, and nothing beyond last 4 / expiry is exposed', async () => {
  const writes = []
  const prisma = { savedCard: { upsert: async (args) => { writes.push(args); return { id: 'c1', ...args.create } } } }
  assert.equal(await saveCardFromAuthorization(prisma, 'u1', { authorization: { ...authorization, reusable: false }, customerEmail: 'a@b.c', channel: 'card' }), null)
  assert.equal(await saveCardFromAuthorization(prisma, 'u1', { authorization, customerEmail: 'a@b.c', channel: 'bank_transfer' }), null)
  const card = await saveCardFromAuthorization(prisma, 'u1', { authorization, customerEmail: 'a@b.c', channel: 'card' })
  assert.equal(writes.length, 1)
  assert.equal(card.last4, '4081')
  const shown = publicCard({ ...card, createdAt: new Date() })
  assert.equal(shown.authorizationCipher, undefined)
  assert.equal(JSON.stringify(shown).includes('AUTH_'), false)
})

test('expiry check uses month and year', () => {
  assert.equal(isExpired({ expMonth: '01', expYear: '2020' }), true)
  assert.equal(isExpired({ expMonth: '12', expYear: '2099' }), false)
})

test('card verification saves the card once and refunds the charge', async () => {
  const state = { verification: { id: 'v1', reference: 'DSPCARD-1', userId: 'u1', amountMinor: 5000, status: 'PENDING' }, saved: 0 }
  const prisma = {
    cardVerification: {
      updateMany: async ({ where, data }) => { if (where.status && state.verification.status !== where.status) return { count: 0 }; Object.assign(state.verification, data); return { count: 1 } },
      update: async ({ data }) => Object.assign(state.verification, data),
    },
    savedCard: { upsert: async (args) => { state.saved += 1; return { id: 'card1', ...args.create } } },
    user: { findMany: async () => [] },
    notification: { createMany: async () => undefined },
  }
  const refunds = []
  const fetchImpl = async (url, options) => { refunds.push([url, JSON.parse(options.body)]); return { ok: true, status: 200, json: async () => ({ status: true, data: { status: 'pending' } }) } }
  const verified = { status: 'success', reference: 'DSPCARD-1', amount: 5000, currency: 'NGN', authorization, customerEmail: 'a@b.c', channel: 'card' }
  const first = await completeCardVerification(prisma, state.verification, verified, 'verify', { fetchImpl })
  assert.equal(first.status, 'SUCCEEDED')
  assert.equal(state.saved, 1)
  assert.deepEqual(refunds.map(([url, body]) => [url, body.transaction]), [['https://api.paystack.co/refund', 'DSPCARD-1']])
  const again = await completeCardVerification(prisma, state.verification, verified, 'webhook', { fetchImpl })
  assert.equal(again.duplicate, true)
  assert.equal(state.saved, 1)
  assert.equal(refunds.length, 1)
  const wrongAmount = await completeCardVerification(prisma, { ...state.verification, status: 'PENDING', id: 'v2' }, { ...verified, amount: 1 }, 'webhook', { fetchImpl })
  assert.equal(wrongAmount.status, 'MISMATCH')
})
