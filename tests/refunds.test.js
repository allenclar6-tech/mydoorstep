import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openRefunds } from '../server/refundRoutes.js'

// Admin › Money › Refunds to send: which refunds are still owed to customers.
const at = (minutes) => new Date(Date.UTC(2026, 10, 3, 10, minutes))

test('a refund stays on the list until it is sent, and comes back if a later one is needed', () => {
  const rows = [
    { paymentId: 'bank', type: 'REFUND_REQUIRED', createdAt: at(1) }, // declined bank-transfer order: owed
    { paymentId: 'card', type: 'REFUND_REQUIRED', createdAt: at(1) }, { paymentId: 'card', type: 'REFUND_INITIATED', createdAt: at(2) }, // Paystack refunded it
    { paymentId: 'failed', type: 'REFUND_REQUIRED', createdAt: at(1) }, { paymentId: 'failed', type: 'REFUND_FAILED', createdAt: at(2) }, // Paystack failed: owed
    { paymentId: 'done', type: 'REFUND_REQUIRED', createdAt: at(1) }, { paymentId: 'done', type: 'REFUND_RECORDED_MANUALLY', createdAt: at(5) }, // admin sent it
    { paymentId: 'twice', type: 'DUPLICATE_PAYMENT_REFUND_REQUIRED', createdAt: at(3) },
    { paymentId: 'other', type: 'PAYMENT_SUCCESS', createdAt: at(1) },
  ]
  const open = openRefunds(rows).map((entry) => entry.paymentId).sort()
  assert.deepEqual(open, ['bank', 'failed', 'twice'])
  assert.equal(openRefunds(rows).find((entry) => entry.paymentId === 'failed').needed.type, 'REFUND_FAILED', 'shows why it is still owed')
  assert.deepEqual(openRefunds([]), [])
})
