import assert from 'node:assert/strict'
import { test } from 'node:test'
import { codeMatches, deliveryCodeFor, dispatchDelivery, estimateArrival, OFFER_SECONDS, rankRiders, riderPosition, sweepDispatch, travelMinutes } from '../server/dispatch.js'

const STORE = { latitude: 5.8950, longitude: 5.6800 }
const near = { latitude: 5.8970, longitude: 5.6810 } // ~250 m
const mid = { latitude: 5.9100, longitude: 5.6800 } // ~1.7 km
const far = { latitude: 6.0000, longitude: 5.6800 } // ~11.7 km

test('riders are ranked nearest first, out-of-range riders dropped, unknown locations last, longest-waiting breaks ties', () => {
  const ranked = rankRiders([
    { riderId: 'mid', position: mid, onlineSince: '2026-10-20T10:00:00Z' },
    { riderId: 'unknown', position: null, onlineSince: '2026-10-20T08:00:00Z' },
    { riderId: 'near', position: near, onlineSince: '2026-10-20T11:00:00Z' },
    { riderId: 'far', position: far, onlineSince: '2026-10-20T07:00:00Z' },
  ], STORE)
  assert.deepEqual(ranked.map((rider) => rider.riderId), ['near', 'mid', 'unknown'])
  const tie = rankRiders([{ riderId: 'b', position: null, onlineSince: '2026-10-20T10:00:00Z' }, { riderId: 'a', position: null, onlineSince: '2026-10-20T09:00:00Z' }], STORE)
  assert.deepEqual(tie.map((rider) => rider.riderId), ['a', 'b'])
})

test('rider position uses only recent locations, preferring the newest', () => {
  const now = Date.parse('2026-10-20T12:00:00Z')
  const rider = { availabilityLatitude: 5.9, availabilityLongitude: 5.68, availabilityLocatedAt: '2026-10-20T11:50:00Z' }
  assert.deepEqual(riderPosition(rider, null, now), { latitude: 5.9, longitude: 5.68 })
  assert.deepEqual(riderPosition(rider, { latitude: 5.91, longitude: 5.69, recordedAt: '2026-10-20T11:58:00Z' }, now), { latitude: 5.91, longitude: 5.69 })
  assert.equal(riderPosition({ ...rider, availabilityLocatedAt: '2026-10-20T10:00:00Z' }, null, now), null)
})

test('arrival estimate waits for the food or the rider, whichever is later, then adds the ride', () => {
  const now = Date.parse('2026-10-20T12:00:00Z')
  const customer = { latitude: 5.9100, longitude: 5.6800 }
  const preparing = estimateArrival({ orderStatus: 'PREPARING', now, acceptedAt: '2026-10-20T11:55:00Z', prepMinutes: 20, storePoint: STORE, customerPoint: customer })
  const ride = travelMinutes(STORE, customer)
  assert.equal(preparing.stage, 'PREPARING')
  assert.equal(preparing.minutes, 15 + ride + 3)
  const onTheWay = estimateArrival({ orderStatus: 'OUT_FOR_DELIVERY', deliveryStatus: 'GOING_TO_CUSTOMER', now, riderPoint: near, storePoint: STORE, customerPoint: customer })
  assert.equal(onTheWay.stage, 'ON_THE_WAY'); assert.equal(onTheWay.live, true)
  assert.equal(estimateArrival({ orderStatus: 'PAID', now }).stage, 'WAITING_FOR_STORE')
  assert.equal(estimateArrival({ orderStatus: 'DELIVERED', now }), null)
})

test('delivery codes are 4 digits, stable per delivery, and compared safely', () => {
  const code = deliveryCodeFor('delivery-1', 'secret')
  assert.match(code, /^\d{4}$/)
  assert.equal(deliveryCodeFor('delivery-1', 'secret'), code)
  assert.notEqual(deliveryCodeFor('delivery-1', 'other-secret'), code)
  assert.equal(codeMatches(code, code), true)
  assert.equal(codeMatches(` ${code} `, code), true)
  assert.equal(codeMatches('12', code), false)
  assert.equal(codeMatches(code === '0000' ? '1111' : '0000', code), false)
})

/* ----- an in-memory database just big enough for the dispatch queries ----- */
function fakeDb({ riders, order }) {
  const deliveries = [{ id: 'd1', orderId: order.id, riderId: null, status: 'AVAILABLE', requestedRiderId: null, requestExpiresAt: null, stuckAlertedAt: null }]
  const offers = []
  const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some((clause) => matches(row, clause))
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('in' in value) return value.in.includes(row[key])
      if ('notIn' in value) return !value.notIn.includes(row[key])
      if ('not' in value) return row[key] !== value.not
      if ('gt' in value) return row[key] && new Date(row[key]) > value.gt
      if ('lte' in value) return row[key] && new Date(row[key]) <= value.lte
      if ('status' in value && key === 'order') return matches(order, value)
      return true
    }
    return row[key] === value
  })
  return {
    offers,
    deliveries,
    delivery: {
      findUnique: async ({ where }) => { const row = deliveries.find((item) => item.id === where.id); return row && { ...row, order } },
      findMany: async ({ where }) => deliveries.filter((row) => matches(row, where)).map((row) => ({ ...row, order })),
      updateMany: async ({ where, data }) => { const rows = deliveries.filter((row) => matches(row, where)); rows.forEach((row) => Object.assign(row, data)); return { count: rows.length } },
    },
    dispatchOffer: {
      findMany: async ({ where }) => offers.filter((row) => row.deliveryId === where.deliveryId && row.offeredAt > where.offeredAt.gt),
      create: async ({ data }) => { offers.push({ ...data }); return data },
      updateMany: async ({ where, data }) => { const rows = offers.filter((row) => matches(row, where)); rows.forEach((row) => Object.assign(row, data)); return { count: rows.length } },
    },
    rider: { findMany: async ({ where }) => riders.filter((rider) => !where.id.notIn.includes(rider.id) && rider.network === where.network && (!where.restaurantId || rider.restaurantId === where.restaurantId)) },
    riderLocation: { findFirst: async () => null },
  }
}
const now = new Date('2026-10-20T12:00:00Z')
const located = (minutesAgo) => new Date(now.getTime() - minutesAgo * 60_000)
const ORDER = { id: 'o1', orderNumber: 'DS-1', status: 'RESTAURANT_ACCEPTED', restaurantId: 'r1', plannedRiderPayMinor: 70_000, deliveryQuote: { km: 3.2 }, acceptedAt: located(1), restaurant: { name: 'Mama Put', ...STORE, application: { deliveryPreference: 'DOORSTEP_RIDERS' } } }
const RIDERS = [
  { id: 'r-mid', userId: 'u-mid', network: 'DOORSTEP_POOL', availabilityLatitude: mid.latitude, availabilityLongitude: mid.longitude, availabilityLocatedAt: located(5), availabilityChangedAt: located(60) },
  { id: 'r-near', userId: 'u-near', network: 'DOORSTEP_POOL', availabilityLatitude: near.latitude, availabilityLongitude: near.longitude, availabilityLocatedAt: located(5), availabilityChangedAt: located(10) },
]

test('an accepted order is offered to the nearest free rider, then the next one when the offer expires', async () => {
  const db = fakeDb({ riders: RIDERS, order: ORDER })
  const notified = []
  const notifyUsers = async (_db, ids, payload) => { notified.push([ids[0], payload.title]) }
  const first = await dispatchDelivery(db, 'd1', { now, notifyUsers })
  assert.equal(first.offered, true); assert.equal(first.riderId, 'r-near')
  assert.equal(db.deliveries[0].status, 'REQUESTED')
  assert.equal(db.deliveries[0].requestExpiresAt.getTime(), now.getTime() + OFFER_SECONDS * 1000)
  assert.deepEqual(notified[0], ['u-near', 'New delivery · you earn ₦700'])
  assert.equal((await dispatchDelivery(db, 'd1', { now, notifyUsers })).reason, 'OFFER_PENDING', 'never two offers at once')

  const later = new Date(now.getTime() + (OFFER_SECONDS + 1) * 1000)
  const swept = await sweepDispatch(db, { now: later, notifyUsers })
  assert.equal(swept.expired, 1); assert.equal(swept.offered, 1)
  assert.equal(db.offers[0].status, 'EXPIRED')
  assert.equal(db.deliveries[0].requestedRiderId, 'r-mid')
})

test('orders the business has not accepted are never offered', async () => {
  const db = fakeDb({ riders: RIDERS, order: { ...ORDER, status: 'PAID' } })
  assert.equal((await dispatchDelivery(db, 'd1', { now })).reason, 'ORDER_NOT_READY_FOR_DISPATCH')
})

test('with nobody free the order stays in the open pool and admins are alerted once after 10 minutes', async () => {
  const db = fakeDb({ riders: [], order: { ...ORDER, acceptedAt: located(12) } })
  const alerts = []
  const notifyAdmins = async (_db, payload) => { alerts.push(payload.title) }
  const result = await sweepDispatch(db, { now, notifyAdmins })
  assert.equal(result.offered, 0)
  assert.equal(db.deliveries[0].status, 'AVAILABLE')
  assert.deepEqual(alerts, ['Order waiting for a rider'])
  await sweepDispatch(db, { now: new Date(now.getTime() + 60_000), notifyAdmins })
  assert.equal(alerts.length, 1, 'alerted only once')
})
