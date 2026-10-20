import test from 'node:test'
import assert from 'node:assert/strict'
import { orderActions, cancelBlockedMessage } from '../server/orderCancellation.js'

test('unpaid orders can be cancelled and deleted with no refund', () => {
  assert.deepEqual(orderActions({ status: 'PENDING_PAYMENT' }), { canCancel: true, cancelNeedsRefund: false, canRemove: true, canPay: true })
})
test('paid orders can be cancelled with a refund until the store accepts, but not removed', () => {
  assert.deepEqual(orderActions({ status: 'PAID' }), { canCancel: true, cancelNeedsRefund: true, canRemove: false, canPay: false })
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
    assert.deepEqual(orderActions({ status }), { canCancel: false, cancelNeedsRefund: false, canRemove: true, canPay: false }, status)
  }
})
test('blocked cancellations explain why and where to get help', () => {
  assert.match(cancelBlockedMessage('PREPARING'), /already started/)
  assert.match(cancelBlockedMessage('OUT_FOR_DELIVERY'), /on its way/)
  assert.match(cancelBlockedMessage('CANCELLED'), /already cancelled/)
})

test('an order\'s notifications are matched by its page link or its order number only', async () => {
  const { orderNotificationWhere, removeOrderNotifications, retireOrderNotifications } = await import('../server/orderCancellation.js')
  const order = { id: 'ord1', orderNumber: 'DSP-20261020-AB12CD' }
  const where = orderNotificationWhere(order)
  assert.deepEqual(where.OR[0], { link: '/account/orders/ord1' })
  assert.ok(where.OR.some((entry) => entry.body?.contains === 'DSP-20261020-AB12CD'))
  const calls = []
  const db = { notification: { deleteMany: async (query) => { calls.push(['delete', query]); return { count: 2 } }, updateMany: async (query) => { calls.push(['update', query]); return { count: 3 } } } }
  assert.equal(await removeOrderNotifications(db, order, 'user1'), 2)
  assert.equal(calls[0][1].where.userId, 'user1', 'only the customer’s own notifications are deleted')
  const before = new Date('2026-10-20T20:00:00Z')
  assert.equal(await retireOrderNotifications(db, order, before), 3)
  assert.deepEqual(calls[1][1].where.createdAt, { lt: before })
  assert.equal(calls[1][1].where.readAt, null)
  assert.ok(calls[1][1].data.readAt instanceof Date)
})
