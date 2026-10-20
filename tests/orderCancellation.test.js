import test from 'node:test'
import assert from 'node:assert/strict'
import { orderActions, cancelBlockedMessage } from '../server/orderCancellation.js'

test('unpaid orders can be cancelled and deleted with no refund', () => {
  assert.deepEqual(orderActions({ status: 'PENDING_PAYMENT' }), { canCancel: true, cancelNeedsRefund: false, canRemove: true })
})
test('paid orders can be cancelled with a refund until the store accepts, but not removed', () => {
  assert.deepEqual(orderActions({ status: 'PAID' }), { canCancel: true, cancelNeedsRefund: true, canRemove: false })
})
test('orders in progress cannot be cancelled or removed', () => {
  for (const status of ['RESTAURANT_ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'RIDER_ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY']) {
    const actions = orderActions({ status })
    assert.equal(actions.canCancel, false, status)
    assert.equal(actions.canRemove, false, status)
  }
})
test('finished orders can be removed from history but not cancelled', () => {
  for (const status of ['CANCELLED', 'DELIVERED', 'REJECTED', 'REFUNDED']) {
    assert.deepEqual(orderActions({ status }), { canCancel: false, cancelNeedsRefund: false, canRemove: true }, status)
  }
})
test('blocked cancellations explain why and where to get help', () => {
  assert.match(cancelBlockedMessage('PREPARING'), /already started/)
  assert.match(cancelBlockedMessage('OUT_FOR_DELIVERY'), /on its way/)
  assert.match(cancelBlockedMessage('CANCELLED'), /already cancelled/)
})
