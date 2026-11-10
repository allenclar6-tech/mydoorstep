import assert from 'node:assert/strict'
import test from 'node:test'
import { failDelivery, markArrived, orderStatusAfterUnassign, unassignRider } from '../server/dispatchControl.js'
import { buckets, riderStats, summarise } from '../server/deliveryOverview.js'

function fakeDb({ deliveryStatus = 'GOING_TO_RESTAURANT', network = 'DOORSTEP_POOL', paid = 520_000 } = {}) {
  const state = {
    delivery: { id: 'd1', status: deliveryStatus, riderId: 'r1', requestedRiderId: null, arrivedAtCustomerAt: null, rider: { id: 'r1', userId: 'u-r1', network } },
    order: { id: 'o1', orderNumber: 'DSP-9', status: deliveryStatus === 'GOING_TO_RESTAURANT' ? 'RIDER_ASSIGNED' : 'OUT_FOR_DELIVERY', preparedAt: null, customerId: 'c1', payment: { id: 'p1', status: 'SUCCESSFUL', amountMinor: paid, reference: 'REF1' } },
    audit: [], ledger: [], transactions: [], notes: [], offers: [],
  }
  const db = {
    state,
    delivery: {
      findUnique: async () => ({ ...state.delivery, order: { ...state.order } }),
      updateMany: async ({ where, data }) => { if (where.status && where.status !== state.delivery.status) return { count: 0 }; if ('arrivedAtCustomerAt' in where && state.delivery.arrivedAtCustomerAt) return { count: 0 }; Object.assign(state.delivery, data); return { count: 1 } },
    },
    order: { update: async ({ data }) => Object.assign(state.order, data) },
    dispatchOffer: { updateMany: async ({ data }) => { state.offers.push(data); return { count: 1 } } },
    auditLog: { create: async ({ data }) => { state.audit.push(data); return data } },
    transaction: { create: async ({ data }) => { state.transactions.push(data); return data } },
    ledgerEntry: { createMany: async ({ data }) => { state.ledger.push(...data); return { count: data.length } } },
    rider: { findUnique: async () => ({ userId: 'u-r1' }) },
    platformSetting: { findUnique: async () => null },
  }
  db.$transaction = (work) => work(db)
  return db
}
const notifyUsers = async (db, ids, message) => { db.state.notes.push({ ids, ...message }) }
const admin = { id: 'admin1' }

test('take a rider off before pickup: job goes back to waiting, rider told, audited', async () => {
  const db = fakeDb()
  await unassignRider(db, 'd1', admin, { reason: 'Bike broke down' }, { notifyUsers })
  assert.equal(db.state.delivery.status, 'AVAILABLE')
  assert.equal(db.state.delivery.riderId, null)
  assert.equal(db.state.order.status, 'PREPARING')
  assert.equal(db.state.audit[0].action, 'DELIVERY_RIDER_REMOVED')
  assert.deepEqual(db.state.notes[0].ids, ['u-r1'])
  assert.equal(orderStatusAfterUnassign({ preparedAt: new Date() }), 'READY_FOR_PICKUP')
  await assert.rejects(unassignRider(fakeDb({ deliveryStatus: 'PICKED_UP' }), 'd1', admin, { reason: 'x' }), (error) => error.code === 'ALREADY_PICKED_UP')
})

test('failed delivery: order closed, refund to the refund queue, rider paid for the trip, business share untouched', async () => {
  const db = fakeDb({ deliveryStatus: 'GOING_TO_CUSTOMER' })
  const result = await failDelivery(db, 'd1', admin, { reason: 'CUSTOMER_UNREACHABLE', note: 'Called 3 times', refundMinor: 520_000, riderPayMinor: 120_000 }, { notifyUsers })
  assert.equal(db.state.delivery.status, 'CANCELLED')
  assert.equal(db.state.delivery.failureReason, 'CUSTOMER_UNREACHABLE')
  assert.equal(db.state.order.status, 'CANCELLED')
  assert.match(db.state.order.cancellationReason, /couldn’t be reached/)
  assert.equal(db.state.transactions[0].type, 'REFUND_REQUIRED')
  assert.equal(db.state.transactions[0].amountMinor, 520_000)
  const earning = db.state.ledger.find((entry) => entry.type === 'RIDER_EARNING')
  assert.equal(earning.amountMinor, 120_000)
  assert.equal(earning.dedupeKey, 'RIDER_EARNING:order:o1', 'same key as a normal delivery, so it can never be paid twice')
  assert.equal(db.state.ledger.some((entry) => entry.party === 'RESTAURANT'), false)
  assert.equal(result.refundMinor, 520_000)
  assert.equal(db.state.notes.length, 2)
})

test('failed delivery rules: refunds can’t exceed what was paid; not before pickup; business riders paid by the business', async () => {
  await assert.rejects(failDelivery(fakeDb({ deliveryStatus: 'GOING_TO_CUSTOMER' }), 'd1', admin, { reason: 'OTHER', note: 'hmm', refundMinor: 999_999 }), (error) => error.code === 'INVALID_REFUND')
  await assert.rejects(failDelivery(fakeDb({ deliveryStatus: 'GOING_TO_RESTAURANT' }), 'd1', admin, { reason: 'OTHER', note: 'x' }), (error) => error.code === 'NOT_ON_THE_WAY')
  await assert.rejects(failDelivery(fakeDb({ deliveryStatus: 'GOING_TO_CUSTOMER' }), 'd1', admin, { reason: 'NOPE', note: 'x' }), (error) => error.code === 'INVALID_REASON')
  const own = fakeDb({ deliveryStatus: 'GOING_TO_CUSTOMER', network: 'BUSINESS_OWNED' })
  await failDelivery(own, 'd1', admin, { reason: 'WRONG_ADDRESS', note: 'No such street', refundMinor: 0, riderPayMinor: 100_000 })
  assert.equal(own.state.ledger.length, 0)
  assert.equal(own.state.transactions.length, 0)
})

test('rider “I’ve arrived”: only the rider on the job, only on the way, only once', async () => {
  const db = fakeDb({ deliveryStatus: 'GOING_TO_CUSTOMER' })
  await assert.rejects(markArrived(db, 'd1', { id: 'someone-else' }), (error) => error.code === 'ASSIGNED_RIDER_REQUIRED')
  const first = await markArrived(db, 'd1', { id: 'r1' }, { notifyUsers })
  assert.equal(first.already, false)
  assert.deepEqual(db.state.notes[0].ids, ['c1'])
  const again = await markArrived(db, 'd1', { id: 'r1' }, { notifyUsers })
  assert.equal(again.already, true)
  assert.equal(db.state.notes.length, 1, 'the customer is told once')
  await assert.rejects(markArrived(fakeDb(), 'd1', { id: 'r1' }), (error) => error.code === 'NOT_ON_THE_WAY')
})

test('overview: continuous daily buckets (weekly for long ranges), money and margin', () => {
  const from = new Date('2026-11-01T00:00:00+01:00')
  const to = new Date('2026-11-08T00:00:00+01:00')
  assert.equal(buckets(from, to).list.length, 7)
  assert.equal(buckets(from, new Date('2027-01-31T00:00:00+01:00')).size, 7)
  const result = summarise({ from, to,
    delivered: [{ deliveredAt: '2026-11-02T10:00:00+01:00', deliveryFeeMinor: 150_000 }, { deliveredAt: '2026-11-02T18:00:00+01:00', deliveryFeeMinor: 100_000 }],
    failed: [{ failedAt: '2026-11-03T12:00:00+01:00' }],
    ledger: [{ party: 'PLATFORM', type: 'DELIVERY_FEE', amountMinor: 250_000, createdAt: '2026-11-02T10:00:00+01:00' }, { party: 'PLATFORM', type: 'DELIVERY_SUBSIDY', amountMinor: -50_000, createdAt: '2026-11-02T10:00:00+01:00' }, { party: 'RIDER', type: 'RIDER_EARNING', amountMinor: 180_000, createdAt: '2026-11-02T19:00:00+01:00' }],
  })
  assert.deepEqual(result.totals, { delivered: 2, failed: 1, incomeMinor: 200_000, riderPayMinor: 180_000, marginMinor: 20_000, averageFeeMinor: 125_000 })
  assert.equal(result.series.find((row) => row.day === '2026-11-02').delivered, 2)
  assert.equal(result.series.find((row) => row.day === '2026-11-03').failed, 1)
})

test('rider performance: acceptance rate, average time, failures', () => {
  const [row] = riderStats({
    offers: [{ riderId: 'r1', status: 'ACCEPTED' }, { riderId: 'r1', status: 'ACCEPTED' }, { riderId: 'r1', status: 'DECLINED' }, { riderId: 'r1', status: 'EXPIRED' }, { riderId: 'r1', status: 'OFFERED' }],
    deliveries: [{ riderId: 'r1', acceptedAt: '2026-11-02T10:00:00Z', deliveredAt: '2026-11-02T10:30:00Z' }, { riderId: 'r1', acceptedAt: '2026-11-02T12:00:00Z', deliveredAt: '2026-11-02T12:50:00Z' }, { riderId: 'r1', failedAt: '2026-11-03T12:00:00Z' }],
    earnings: [{ riderId: 'r1', amountMinor: 120_000 }, { riderId: 'r1', amountMinor: 20_000 }],
  })
  assert.equal(row.acceptanceRate, 50)
  assert.equal(row.averageMinutes, 40)
  assert.equal(row.delivered, 2)
  assert.equal(row.failed, 1)
  assert.equal(row.earnedMinor, 140_000)
})
