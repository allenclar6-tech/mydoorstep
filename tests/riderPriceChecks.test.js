import assert from 'node:assert/strict'
import test from 'node:test'
import { answerCheck, askRiders, checkIsOpen, checkRiderChoice, openChecksForRider, pickRidersToAsk, riderPricesFor } from '../server/riderPriceChecks.js'
import { rankRiders } from '../server/dispatch.js'

// Delivery prices for hard-to-map places are fixed between DOORSTEP admins and riders. Customers don't negotiate.

const rider = (id, patch = {}) => ({ id, userId: `u-${id}`, status: 'APPROVED', network: 'DOORSTEP_POOL', availability: 'OFFLINE', availabilityLatitude: null, availabilityLongitude: null, availabilityChangedAt: null, ...patch })

function fakeDb({ orderStatus = 'AWAITING_DELIVERY_QUOTE', riders = [rider('r1', { availability: 'ONLINE' }), rider('r2'), rider('own', { network: 'BUSINESS_OWNED' })] } = {}) {
  const order = { id: 'o1', orderNumber: 'DSP-7', status: orderStatus, deliveryQuote: { dropoffZone: { id: 'z', name: 'Amukpe' } }, restaurant: { name: 'Mama Put', address: '12 Market Rd', latitude: 5.89, longitude: 5.68 } }
  const quote = { id: 'q1', orderId: 'o1', status: 'PENDING_REVIEW', landmark: 'Opposite the church', originalDistance: { km: 6.2, verificationStatus: 'STRAIGHT_LINE_DISTANCE' }, correctedDistanceKm: null, riderAskAt: null, riderAskPayMinor: null, riderAskNote: null }
  const suggestions = []
  const events = []
  const notifications = []
  const audit = []
  const people = riders.map((row) => ({ ...row, ratingAverage: 4.6, ratingCount: 12, vehicleType: 'Motorcycle', user: { firstName: `Rider ${row.id}`, lastName: '', phone: '0800' } }))
  return {
    order, quote, suggestions, events, notifications, audit,
    deliveryQuotation: {
      findUnique: async () => ({ ...quote, order }),
      findMany: async ({ where, include }) => (quote.riderAskAt && quote.riderAskAt >= where.riderAskAt.gte && order.status === where.order.status ? [{ ...quote, order, riderPrices: suggestions.filter((row) => row.riderId === include.riderPrices.where.riderId) }] : []),
      update: async ({ data }) => Object.assign(quote, data),
    },
    rider: { findMany: async ({ where }) => (where?.id ? people.filter((row) => where.id.in.includes(row.id)) : riders.filter((row) => row.status === where.status && row.network === where.network)) },
    riderPriceSuggestion: {
      upsert: async ({ where, update, create }) => {
        const found = suggestions.find((row) => row.quotationId === where.quotationId_riderId.quotationId && row.riderId === where.quotationId_riderId.riderId)
        if (found) return Object.assign(found, update, { updatedAt: new Date() })
        const row = { id: `s${suggestions.length + 1}`, ...create, createdAt: new Date(), updatedAt: new Date() }
        suggestions.push(row); return row
      },
      findUnique: async ({ where }) => suggestions.find((row) => row.quotationId === where.quotationId_riderId.quotationId && row.riderId === where.quotationId_riderId.riderId) || null,
      findMany: async () => [...suggestions],
    },
    deliveryQuotationEvent: { create: async ({ data }) => { events.push(data); return data } },
    auditLog: { create: async ({ data }) => { audit.push(data); return data } },
    notification: { createMany: async ({ data }) => { notifications.push(...data); return { count: data.length } } },
    user: { findMany: async () => [{ id: 'admin1' }] },
  }
}
const admin = { id: 'admin1' }

test('riders asked: approved DOORSTEP riders only, online and nearest first', () => {
  const store = { latitude: 5.89, longitude: 5.68 }
  const list = [
    rider('far-online', { availability: 'ONLINE', availabilityLatitude: 5.99, availabilityLongitude: 5.78 }),
    rider('near-online', { availability: 'ONLINE', availabilityLatitude: 5.891, availabilityLongitude: 5.681 }),
    rider('offline'),
    rider('pending', { status: 'PENDING_APPROVAL', availability: 'ONLINE' }),
    rider('business', { network: 'BUSINESS_OWNED', availability: 'ONLINE' }),
  ]
  assert.deepEqual(pickRidersToAsk(list, store).map((row) => row.id), ['near-online', 'far-online', 'offline'])
  assert.equal(pickRidersToAsk(Array.from({ length: 40 }, (_, index) => rider(`r${index}`)), store).length, 20)
})

test('admin asks riders; riders see the trip without customer details and answer; admin sees named answers', async () => {
  const db = fakeDb()
  const { asked } = await askRiders(db, 'q1', admin, { suggestedPayMinor: 120_000, note: 'Untarred road' })
  assert.equal(asked, 2, 'business-owned riders are not asked')
  assert.deepEqual(db.notifications.map((row) => row.userId).sort(), ['u-r1', 'u-r2'])
  assert.equal(db.notifications[0].link, '/rider/price-checks')
  assert.equal(db.events[0].type, 'RIDERS_ASKED')

  const [check] = await openChecksForRider(db, rider('r1'))
  assert.equal(check.orderNumber, 'DSP-7')
  assert.equal(check.dropoffArea, 'Amukpe')
  assert.equal(check.landmark, 'Opposite the church')
  assert.equal(check.suggestedPayMinor, 120_000)
  for (const secret of ['customer', 'phone', 'address', 'addressSnapshot', 'latitude']) assert.equal(secret in check, false, `riders don’t see the customer’s ${secret}`)
  assert.deepEqual(await openChecksForRider(db, rider('own', { network: 'BUSINESS_OWNED' })), [])

  await answerCheck(db, rider('r1'), 'q1', { response: 'AGREE' })
  await answerCheck(db, rider('r2'), 'q1', { response: 'COUNTER', amountMinor: 150_000, note: 'Bad bridge' })
  assert.equal(db.suggestions.find((row) => row.riderId === 'r1').amountMinor, 120_000, 'agreeing means the suggested pay')
  await answerCheck(db, rider('r2'), 'q1', { response: 'COUNTER', amountMinor: 140_000 })
  assert.equal(db.suggestions.length, 2, 'a rider can change their answer (one per rider)')
  assert.ok(db.notifications.some((row) => row.userId === 'admin1' && /DSP-7/.test(row.title)))

  const prices = await riderPricesFor(db, 'q1')
  assert.equal(prices.find((row) => row.riderId === 'r2').amountMinor, 140_000)
  assert.equal(prices[0].name.startsWith('Rider'), true)
})

test('answers are validated and checks close with the order', async () => {
  const db = fakeDb()
  await assert.rejects(answerCheck(db, rider('r1'), 'q1', { response: 'AGREE' }), (error) => error.code === 'CHECK_CLOSED', 'nothing asked yet')
  await askRiders(db, 'q1', admin, {})
  await assert.rejects(answerCheck(db, rider('r1'), 'q1', { response: 'AGREE' }), (error) => error.code === 'NO_SUGGESTED_PRICE')
  await assert.rejects(answerCheck(db, rider('r1'), 'q1', { response: 'COUNTER', amountMinor: 50 }), (error) => error.code === 'INVALID_AMOUNT')
  await assert.rejects(answerCheck(db, rider('x', { status: 'PENDING_APPROVAL' }), 'q1', { response: 'DECLINE' }), (error) => error.code === 'NOT_A_DOORSTEP_RIDER')
  assert.equal(checkIsOpen({ riderAskAt: new Date() }, 'PENDING_PAYMENT'), false, 'closed once the customer has a price')
  assert.equal(checkIsOpen({ riderAskAt: new Date(Date.now() - 49 * 3_600_000) }, 'AWAITING_DELIVERY_QUOTE'), false, 'closed after 48 hours')
  const paid = fakeDb({ orderStatus: 'PENDING_PAYMENT' })
  await assert.rejects(askRiders(paid, 'q1', admin, {}), (error) => error.code === 'ORDER_NOT_AWAITING_PRICE')
})

test('the admin can’t pay a rider less than the price they agreed', async () => {
  const db = fakeDb()
  await askRiders(db, 'q1', admin, { suggestedPayMinor: 120_000 })
  await answerCheck(db, rider('r2'), 'q1', { response: 'COUNTER', amountMinor: 150_000 })
  await answerCheck(db, rider('r1'), 'q1', { response: 'DECLINE' })
  await assert.rejects(checkRiderChoice(db, 'q1', { riderPayMinor: 120_000, agreedRiderId: 'r2' }), (error) => error.code === 'RIDER_PAY_BELOW_AGREED')
  await assert.rejects(checkRiderChoice(db, 'q1', { riderPayMinor: 150_000, agreedRiderId: 'r1' }), (error) => error.code === 'RIDER_DIDNT_AGREE')
  await checkRiderChoice(db, 'q1', { riderPayMinor: 150_000, agreedRiderId: 'r2' })
  await checkRiderChoice(db, 'q1', { riderPayMinor: 130_000 })
})

test('the rider who agreed the price gets the first job offer when free and nearby', () => {
  const pickup = { latitude: 5.89, longitude: 5.68 }
  const candidates = [
    { riderId: 'close', position: { latitude: 5.8901, longitude: 5.6801 } },
    { riderId: 'agreed', position: { latitude: 5.92, longitude: 5.70 } },
    { riderId: 'too-far', position: { latitude: 6.5, longitude: 6.3 } },
  ]
  assert.equal(rankRiders(candidates, pickup)[0].riderId, 'close')
  assert.equal(rankRiders(candidates, pickup, { preferredRiderId: 'agreed' })[0].riderId, 'agreed')
  assert.equal(rankRiders(candidates, pickup, { preferredRiderId: 'too-far' })[0].riderId, 'close', 'still limited to riders near the store')
})
