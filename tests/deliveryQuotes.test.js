import assert from 'node:assert/strict'
import test from 'node:test'
import { checkOffer, checkResponse, distanceRecord, distanceStatus, locationConfidence, manualQuoteReasons, pickupMoved, QuoteError, totalsWithDeliveryFee } from '../server/deliveryAssessment.js'
import { defaultDeliveryPricing, pricingMethodFor, priceDelivery } from '../server/deliveryPricing.js'
import { deliveryPricingSchema } from '../server/deliveryPricingSettings.js'
import { orderActions } from '../server/orderCancellation.js'
import { cancelQuote, expireQuotes, keepPrice, openDeliveryQuotation, respondToQuote, sendOffer } from '../server/quotationService.js'

const finance = { commission: { doorstepRiderPercent: 15, ownRiderPercent: 10 }, riderRates: { published: false } }
const pricing = (patch = {}) => ({ ...structuredClone(defaultDeliveryPricing), published: true, ...patch })
const manual = defaultDeliveryPricing.manualQuotes

/* ------------------------------ distance & confidence ------------------------------ */
test('distance statuses and confidence come only from what was actually measured', () => {
  assert.equal(distanceStatus({ distance: { source: 'ROAD' }, warnings: [] }), 'VERIFIED_ROAD_DISTANCE')
  assert.equal(distanceStatus({ distance: { source: 'ROAD' }, dropoffSource: 'AREA_CENTRE', warnings: ['AREA_CENTRE'] }), 'ESTIMATED_ROAD_DISTANCE')
  assert.equal(distanceStatus({ distance: { source: 'ROAD_CAPPED' }, warnings: ['LONG_DETOUR_CAPPED'] }), 'ESTIMATED_ROAD_DISTANCE')
  assert.equal(distanceStatus({ distance: { source: 'ESTIMATE' }, warnings: ['ROUTING_UNAVAILABLE'] }), 'STRAIGHT_LINE_DISTANCE')
  assert.equal(distanceStatus({ distance: { source: 'ROAD' }, warnings: ['PICKUP_AREA_CENTRE'] }), 'UNVERIFIED_DISTANCE')
  assert.equal(distanceStatus({ distance: { source: 'ASSUMED' }, warnings: ['ASSUMED_DISTANCE'] }), 'UNAVAILABLE_DISTANCE')
  assert.deepEqual(['VERIFIED_ROAD_DISTANCE', 'ESTIMATED_ROAD_DISTANCE', 'STRAIGHT_LINE_DISTANCE', 'UNAVAILABLE_DISTANCE'].map(locationConfidence), ['HIGH', 'MEDIUM', 'LOW', 'UNVERIFIED'])
})

test('a straight-line estimate is never recorded as a road distance', () => {
  const record = distanceRecord({ km: 6.1, distance: { source: 'ESTIMATE', meters: 6100, straightMeters: 4500, roadMeters: null }, warnings: ['ROUTING_UNAVAILABLE'] }, { pickup: { latitude: 5.9, longitude: 5.68 }, dropoff: { latitude: 5.93, longitude: 5.7 } })
  assert.equal(record.verificationStatus, 'STRAIGHT_LINE_DISTANCE')
  assert.equal(record.roadKm, null)
  assert.equal(record.straightLineKm, 4.5)
  assert.equal(record.provider, 'none')
  assert.equal(record.routeStatus, 'ROUTING_UNAVAILABLE')
  assert.ok(record.calculatedAt && record.origin && record.destination)
})

test('manual quote triggers: unmapped, unreliable, too far, fee limit; fixed prices skip distance checks', () => {
  const roadOk = { km: 5, method: 'DISTANCE', distance: { source: 'ROAD' }, warnings: [], customer: { deliveryFeeMinor: 150_000 } }
  assert.deepEqual(manualQuoteReasons(roadOk, manual, { maxDeliveryKm: 15 }), [])
  assert.deepEqual(manualQuoteReasons({ ...roadOk, distance: { source: 'ASSUMED' } }, manual), ['LOCATION_NOT_MAPPED'])
  assert.deepEqual(manualQuoteReasons({ ...roadOk, distance: { source: 'ESTIMATE' } }, manual), ['DISTANCE_NOT_RELIABLE'])
  assert.deepEqual(manualQuoteReasons({ ...roadOk, distance: { source: 'ESTIMATE' } }, { ...manual, minConfidence: 'LOW' }), [])
  assert.deepEqual(manualQuoteReasons({ ...roadOk, km: 22 }, manual, { maxDeliveryKm: 15 }), ['BEYOND_NORMAL_DISTANCE'])
  assert.deepEqual(manualQuoteReasons(roadOk, { ...manual, maxAutoFeeMinor: 100_000 }), ['FEE_ABOVE_AUTO_LIMIT'])
  assert.deepEqual(manualQuoteReasons({ ...roadOk, method: 'AREA_FIXED', distance: { source: 'ASSUMED' } }, manual), [], 'a fixed area price needs no map distance')
  assert.deepEqual(manualQuoteReasons({ ...roadOk, distance: { source: 'ASSUMED' } }, { ...manual, enabled: false }), [])
})

/* ------------------------------ pricing engine ------------------------------ */
const road = (km) => ({ meters: km * 1000, source: 'ROAD', straightMeters: km * 800, roadMeters: km * 1000, warnings: [] })

test('distance formula: base + extra km, minimum, maximum and rounding (₦700 base + ₦150/km example)', () => {
  const p = pricing({ customerFee: { baseMinor: 70_000, includedKm: 0, perKmMinor: 15_000, minimumMinor: 50_000, maximumMinor: 500_000, roundToMinor: 1_000 }, margin: { protect: false, minimumMinor: 0 } })
  const priced = priceDelivery({ distance: road(5.8), pricing: p, finance })
  assert.equal(priced.customer.deliveryFeeMinor, 157_000) // ₦700 + 5.8 × ₦150 = ₦1,570
  assert.equal(priced.method, 'DISTANCE')
  const min = priceDelivery({ distance: road(0.1), pricing: { ...p, customerFee: { ...p.customerFee, baseMinor: 10_000, minimumMinor: 60_000 } }, finance })
  assert.equal(min.customer.deliveryFeeMinor, 60_000)
  const max = priceDelivery({ distance: road(40), pricing: p, finance })
  assert.equal(max.customer.deliveryFeeMinor, 500_000)
})

test('fixed area price wins over distance; precedence between area and agreed route is explicit', () => {
  const zones = [{ id: 'amukpe', name: 'Amukpe', fixedFeeMinor: 150_000, remote: false, active: true }, { id: 'central', name: 'Central', fixedFeeMinor: null, active: true }]
  const rule = { id: 'r1', fromZoneId: 'central', toZoneId: 'amukpe', bothWays: true, customerFeeMinor: 120_000, riderPayMinor: null, active: true }
  const p = pricing({ zones, routeRules: [rule], margin: { protect: false, minimumMinor: 0 } })
  const areaFirst = priceDelivery({ distance: road(3), pickupZone: zones[1], dropoffZone: zones[0], pricing: p, finance })
  assert.equal(areaFirst.method, 'AREA_FIXED')
  assert.equal(areaFirst.customer.deliveryFeeMinor, 150_000)
  const routeFirst = priceDelivery({ distance: road(3), pickupZone: zones[1], dropoffZone: zones[0], pricing: { ...p, precedence: 'ROUTE_FIRST' }, finance })
  assert.equal(routeFirst.method, 'ROUTE_RULE')
  assert.equal(routeFirst.customer.deliveryFeeMinor, 120_000)
  assert.equal(pricingMethodFor({ rule: null, dropoffZone: null }), 'DISTANCE')
})

test('remote and weekend surcharges, and free delivery over a threshold', () => {
  const zone = { id: 'far', name: 'Far village', fixedFeeMinor: 300_000, remote: true, active: true }
  const p = pricing({ zones: [zone], surcharges: { remoteMinor: 50_000, weekend: { active: true, minor: 20_000 } }, margin: { protect: false, minimumMinor: 0 } })
  const saturday = new Date('2026-11-07T12:00:00+01:00')
  const monday = new Date('2026-11-09T12:00:00+01:00')
  assert.equal(priceDelivery({ distance: road(9), dropoffZone: zone, pricing: p, finance, now: saturday }).customer.deliveryFeeMinor, 370_000)
  assert.equal(priceDelivery({ distance: road(9), dropoffZone: zone, pricing: p, finance, now: monday }).customer.deliveryFeeMinor, 350_000)
  const free = priceDelivery({ distance: road(3), pricing: { ...p, freeDelivery: { active: true, thresholdMinor: 1_000_000 } }, subtotalMinor: 1_200_000, finance, now: monday })
  assert.equal(free.customer.deliveryFeeMinor, 0)
  assert.equal(free.method, 'FREE_THRESHOLD')
  assert.ok(free.customer.freeDeliveryMinor > 0)
})

test('older saved settings still load: new fields get safe defaults', () => {
  const { surcharges, freeDelivery, precedence, manualQuotes, ...old } = structuredClone(defaultDeliveryPricing)
  old.zones = old.zones.slice(0, 2).map(({ fixedFeeMinor, remote, ...zone }) => zone)
  const parsed = deliveryPricingSchema.parse(old)
  assert.equal(parsed.manualQuotes.enabled, true)
  assert.equal(parsed.precedence, 'AREA_FIRST')
  assert.equal(parsed.zones[0].fixedFeeMinor, null)
  assert.equal(parsed.freeDelivery.active, false)
})

/* ------------------------------ quote rules ------------------------------ */
test('offer and response rules: versions, expiry, review limits', () => {
  assert.equal(checkOffer({ status: 'PENDING_REVIEW', currentVersion: 0 }, { feeMinor: 150_000, maxQuoteMinor: 2_000_000 }), 'QUOTE_SENT')
  assert.equal(checkOffer({ status: 'CUSTOMER_REVIEW_REQUESTED', currentVersion: 1 }, { feeMinor: 120_000 }), 'QUOTE_REVISED')
  assert.throws(() => checkOffer({ status: 'QUOTE_ACCEPTED', currentVersion: 1 }, { feeMinor: 1 }), /closed/)
  assert.throws(() => checkOffer({ status: 'PENDING_REVIEW', currentVersion: 0 }, { feeMinor: 3_000_000, maxQuoteMinor: 2_000_000 }), (error) => error.code === 'FEE_ABOVE_LIMIT')
  const sent = { status: 'QUOTE_SENT', currentVersion: 2, reviewRounds: 0, expiresAt: new Date(Date.now() + 3_600_000) }
  assert.equal(checkResponse(sent, { action: 'ACCEPT', version: 2, maxRounds: 3 }), 'QUOTE_ACCEPTED')
  assert.throws(() => checkResponse(sent, { action: 'ACCEPT', version: 1, maxRounds: 3 }), (error) => error.code === 'QUOTE_CHANGED', 'accepting an old version is refused')
  assert.throws(() => checkResponse({ ...sent, expiresAt: new Date(Date.now() - 1000) }, { action: 'ACCEPT', version: 2, maxRounds: 3 }), (error) => error.code === 'QUOTE_EXPIRED')
  assert.throws(() => checkResponse({ ...sent, reviewRounds: 3 }, { action: 'REVIEW', version: 2, maxRounds: 3 }), (error) => error.code === 'NO_MORE_REVIEWS')
  assert.throws(() => checkResponse({ ...sent, status: 'QUOTE_ACCEPTED' }, { action: 'ACCEPT', version: 2, maxRounds: 3 }), (error) => error.code === 'ALREADY_ACCEPTED')
})

test('agreed fee sets the totals; discounts never go below zero; a moved pickup voids the price', () => {
  assert.deepEqual(totalsWithDeliveryFee({ subtotalMinor: 500_000, serviceFeeMinor: 15_000, tipMinor: 10_000, discountMinor: 20_000 }, 150_000), { deliveryFeeMinor: 150_000, discountMinor: 20_000, totalMinor: 655_000 })
  assert.equal(totalsWithDeliveryFee({ subtotalMinor: 1000, serviceFeeMinor: 0, discountMinor: 50_000 }, 0).totalMinor, 0)
  assert.equal(pickupMoved({ latitude: 5.89, longitude: 5.68 }, { latitude: 5.8901, longitude: 5.6801 }), false)
  assert.equal(pickupMoved({ latitude: 5.89, longitude: 5.68 }, { latitude: 5.9, longitude: 5.68 }), true)
})

test('an order waiting for its delivery price can be cancelled but never paid', () => {
  assert.deepEqual(orderActions({ status: 'AWAITING_DELIVERY_QUOTE' }), { canCancel: true, cancelNeedsRefund: false, canRemove: true, canPay: false })
  assert.equal(orderActions({ status: 'PENDING_PAYMENT' }).canPay, true)
})

/* ------------------------------ full flow on an in-memory database ------------------------------ */
// Column defaults the real database applies (see prisma/schema.prisma).
const DEFAULTS = { deliveryQuotation: { currentVersion: 0, reviewRounds: 0, expiresAt: null }, deliveryQuotationVersion: { status: 'OFFERED' } }
function fakeDb() {
  const tables = { order: [], payment: [], deliveryQuotation: [], deliveryQuotationVersion: [], deliveryQuotationEvent: [], auditLog: [], notification: [], user: [{ id: 'admin1', role: 'ADMIN', status: 'ACTIVE' }], restaurantUser: [{ userId: 'owner1', restaurantId: 'r1' }], platformSetting: [] }
  let seq = 0
  const matches = (row, where = {}) => Object.entries(where).every(([key, condition]) => {
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      if ('in' in condition) return condition.in.includes(row[key])
      if ('lte' in condition) return row[key] != null && new Date(row[key]) <= new Date(condition.lte)
      if ('quotationId_version' === key) return row.quotationId === condition.quotationId && row.version === condition.version
      return true
    }
    return row[key] === condition
  })
  const apply = (row, data) => { for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === 'object' && 'increment' in value ? (row[key] || 0) + value.increment : value; return row }
  const model = (name, joins = {}) => ({
    async findUnique({ where, include }) { const key = Object.keys(where)[0]; const row = key === 'quotationId_version' ? tables[name].find((r) => r.quotationId === where[key].quotationId && r.version === where[key].version) : tables[name].find((r) => r[key] === where[key]); return row ? join(row, include, joins) : null },
    async findFirst({ where, include }) { const row = tables[name].find((r) => matches(r, where)); return row ? join(row, include, joins) : null },
    async findMany({ where = {}, include }) { return tables[name].filter((r) => matches(r, where)).map((row) => join(row, include, joins)) },
    async create({ data }) { const row = { id: `${name}${++seq}`, createdAt: new Date(), ...(DEFAULTS[name] || {}), ...data }; tables[name].push(row); return row },
    async createMany({ data }) { for (const row of data) tables[name].push({ id: `${name}${++seq}`, ...row }); return { count: data.length } },
    async update({ where, data }) { const row = tables[name].find((r) => r.id === where.id); apply(row, data); return row },
    async updateMany({ where, data }) { const rows = tables[name].filter((r) => matches(r, where)); rows.forEach((row) => apply(row, data)); return { count: rows.length } },
  })
  const join = (row, include, joins) => { const out = { ...row }; for (const key of Object.keys(include || {})) if (joins[key]) out[key] = joins[key](row); return out }
  const db = {
    tables,
    order: model('order', { payment: (o) => tables.payment.find((p) => p.orderId === o.id) || null, deliveryQuotation: (o) => tables.deliveryQuotation.find((q) => q.orderId === o.id) || null, restaurant: (o) => o.restaurant }),
    payment: model('payment'),
    deliveryQuotation: model('deliveryQuotation', { order: (q) => { const o = tables.order.find((x) => x.id === q.orderId); return { ...o, payment: tables.payment.find((p) => p.orderId === o.id) || null } } }),
    deliveryQuotationVersion: model('deliveryQuotationVersion'),
    deliveryQuotationEvent: model('deliveryQuotationEvent'),
    auditLog: model('auditLog'),
    notification: model('notification'),
    user: model('user'),
    restaurantUser: model('restaurantUser'),
    platformSetting: model('platformSetting'),
    async $transaction(fn) { return fn(db) },
  }
  return db
}

async function placeAwaitingOrder(db, { method = 'PAYSTACK' } = {}) {
  const order = await db.order.create({ data: { orderNumber: 'DSP-1', customerId: 'cust1', restaurantId: 'r1', status: 'AWAITING_DELIVERY_QUOTE', subtotalMinor: 500_000, serviceFeeMinor: 15_000, tipMinor: 0, discountMinor: 0, deliveryFeeMinor: 0, totalMinor: 515_000, restaurant: { name: 'Mama Put', latitude: 5.89, longitude: 5.68 } } })
  await db.payment.create({ data: { orderId: order.id, method, status: 'PENDING', amountMinor: 515_000, reference: 'ref' } })
  await openDeliveryQuotation(db, order, { manualQuote: { reasons: ['LOCATION_NOT_MAPPED'], estimateFeeMinor: 120_000, landmark: 'Opposite the church' }, delivery: { km: 4, distance: { source: 'ASSUMED', meters: 4000 }, warnings: [], pickupPoint: { latitude: 5.89, longitude: 5.68 }, dropoffPoint: null } }, { customerId: 'cust1' })
  return { order, quote: db.tables.deliveryQuotation[0] }
}

test('flow: request → price → accept makes the order payable with the agreed fee (nothing charged before)', async () => {
  const db = fakeDb()
  const { order, quote } = await placeAwaitingOrder(db)
  assert.equal(quote.status, 'PENDING_REVIEW')
  await assert.rejects(respondToQuote(db, order.id, { id: 'cust1' }, { action: 'ACCEPT', version: 1 }), (error) => error.code === 'NO_PRICE_TO_ANSWER')
  await sendOffer(db, quote.id, { id: 'admin1' }, { feeMinor: 180_000, explanation: 'Off the main road' })
  assert.equal(db.tables.deliveryQuotation[0].status, 'QUOTE_SENT')
  assert.equal(db.tables.order[0].status, 'AWAITING_DELIVERY_QUOTE', 'still not payable after the offer')
  await assert.rejects(respondToQuote(db, order.id, { id: 'someone-else' }, { action: 'ACCEPT', version: 1 }), (error) => error.code === 'QUOTE_NOT_FOUND', 'only the order’s customer can answer')
  await respondToQuote(db, order.id, { id: 'cust1' }, { action: 'ACCEPT', version: 1 })
  const saved = db.tables.order[0]
  assert.equal(saved.status, 'PENDING_PAYMENT')
  assert.equal(saved.deliveryFeeMinor, 180_000)
  assert.equal(saved.totalMinor, 695_000)
  assert.equal(db.tables.payment[0].amountMinor, 695_000)
  assert.equal(db.tables.payment[0].status, 'PENDING', 'accepting never marks anything paid')
  await assert.rejects(respondToQuote(db, order.id, { id: 'cust1' }, { action: 'ACCEPT', version: 1 }), (error) => error.code === 'ALREADY_ACCEPTED', 'duplicate accept is refused')
  await assert.rejects(sendOffer(db, quote.id, { id: 'admin1' }, { feeMinor: 100 }), (error) => error.code === 'ORDER_NOT_AWAITING_PRICE', 'an accepted price can’t be silently changed')
  assert.ok(db.tables.auditLog.some((row) => row.action === 'DELIVERY_QUOTE_ACCEPTED'))
})

test('flow: review request → revised price needs fresh acceptance; the old version is kept', async () => {
  const db = fakeDb()
  const { order, quote } = await placeAwaitingOrder(db)
  await sendOffer(db, quote.id, { id: 'admin1' }, { feeMinor: 250_000 })
  await respondToQuote(db, order.id, { id: 'cust1' }, { action: 'REVIEW', version: 1, message: 'Too high, I’m close to the market' })
  assert.equal(db.tables.deliveryQuotation[0].status, 'CUSTOMER_REVIEW_REQUESTED')
  await sendOffer(db, quote.id, { id: 'admin1' }, { feeMinor: 200_000, explanation: 'Reduced', correctedDistanceKm: 4.2, correctionReason: 'Checked with rider' })
  const q = db.tables.deliveryQuotation[0]
  assert.equal(q.status, 'QUOTE_REVISED')
  assert.equal(q.currentVersion, 2)
  assert.equal(q.correctedDistanceKm, 4.2)
  assert.equal(q.originalDistance.verificationStatus, 'UNAVAILABLE_DISTANCE', 'original routing result kept')
  assert.equal(db.tables.deliveryQuotationVersion.length, 2)
  await assert.rejects(respondToQuote(db, order.id, { id: 'cust1' }, { action: 'ACCEPT', version: 1 }), (error) => error.code === 'QUOTE_CHANGED', 'the earlier answer doesn’t approve the new amount')
  await respondToQuote(db, order.id, { id: 'cust1' }, { action: 'ACCEPT', version: 2 })
  assert.equal(db.tables.order[0].deliveryFeeMinor, 200_000)
  assert.deepEqual(db.tables.deliveryQuotationEvent.map((event) => event.type), ['REQUESTED', 'QUOTE_SENT', 'CUSTOMER_REVIEW_REQUESTED', 'QUOTE_REVISED', 'DISTANCE_CORRECTED', 'CUSTOMER_ACCEPTED'])
})

test('flow: expired prices can’t be accepted; admin can keep a price or cancel; decline cancels unpaid order', async () => {
  const db = fakeDb()
  const { order, quote } = await placeAwaitingOrder(db)
  await sendOffer(db, quote.id, { id: 'admin1' }, { feeMinor: 150_000, expiresInHours: 1 })
  db.tables.deliveryQuotation[0].expiresAt = new Date(Date.now() - 1000)
  await assert.rejects(respondToQuote(db, order.id, { id: 'cust1' }, { action: 'ACCEPT', version: 1 }), (error) => error.code === 'QUOTE_EXPIRED')
  assert.equal(db.tables.deliveryQuotation[0].status, 'QUOTE_EXPIRED')
  assert.equal(db.tables.order[0].status, 'AWAITING_DELIVERY_QUOTE')
  await sendOffer(db, quote.id, { id: 'admin1' }, { feeMinor: 140_000 })
  await respondToQuote(db, order.id, { id: 'cust1' }, { action: 'REVIEW', version: 2, message: 'please' })
  await keepPrice(db, quote.id, { id: 'admin1' }, 'The road there is very bad.')
  assert.equal(db.tables.deliveryQuotation[0].status, 'QUOTE_SENT')
  await respondToQuote(db, order.id, { id: 'cust1' }, { action: 'DECLINE', version: 2 })
  assert.equal(db.tables.order[0].status, 'CANCELLED')
  assert.equal(db.tables.payment[0].status, 'ABANDONED')

  const db2 = fakeDb()
  const second = await placeAwaitingOrder(db2, { method: 'BANK_TRANSFER' })
  await cancelQuote(db2, second.quote.id, { id: 'admin1' }, 'No road access in the rainy season.')
  assert.equal(db2.tables.order[0].status, 'CANCELLED')
  assert.equal(db2.tables.deliveryQuotation[0].status, 'QUOTE_CANCELLED')
})

test('flow: bank transfer only becomes payable after acceptance; the sweep expires old prices', async () => {
  const db = fakeDb()
  const { order, quote } = await placeAwaitingOrder(db, { method: 'BANK_TRANSFER' })
  assert.equal(db.tables.payment[0].status, 'PENDING', 'no transfer requested before a price is agreed')
  await sendOffer(db, quote.id, { id: 'admin1' }, { feeMinor: 100_000 })
  await respondToQuote(db, order.id, { id: 'cust1' }, { action: 'ACCEPT', version: 1 })
  assert.equal(db.tables.payment[0].status, 'PENDING_VERIFICATION')

  const db2 = fakeDb()
  const other = await placeAwaitingOrder(db2)
  await sendOffer(db2, other.quote.id, { id: 'admin1' }, { feeMinor: 100_000 })
  db2.tables.deliveryQuotation[0].expiresAt = new Date(Date.now() - 1)
  assert.equal(await expireQuotes(db2), 1)
  assert.equal(db2.tables.deliveryQuotation[0].status, 'QUOTE_EXPIRED')
  assert.equal(db2.tables.deliveryQuotationVersion[0].status, 'EXPIRED')
})

test('flow: if the store moves its pickup point, acceptance is stopped and the price must be set again', async () => {
  const db = fakeDb()
  const { order, quote } = await placeAwaitingOrder(db)
  await sendOffer(db, quote.id, { id: 'admin1' }, { feeMinor: 100_000 })
  db.tables.order[0].restaurant = { name: 'Mama Put', latitude: 5.95, longitude: 5.68 }
  const result = await respondToQuote(db, order.id, { id: 'cust1' }, { action: 'ACCEPT', version: 1 })
  assert.equal(result.requote, true)
  assert.equal(db.tables.deliveryQuotation[0].status, 'PENDING_REVIEW')
  assert.equal(db.tables.order[0].status, 'AWAITING_DELIVERY_QUOTE')
  assert.ok(QuoteError)
})
