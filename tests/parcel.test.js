import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { assertWithinServiceArea, fetchRoadRoutes, haversineMeters, parcelPricingSchema, parcelReference, parcelStatusByDeliveryStatus, priceRoute, resolveService } from '../server/parcelService.js'
import { confirmParcelPayment, parcelBookingSchema, serializeParcel } from '../server/parcelRoutes.js'

process.env.NODE_ENV = 'test'

const service = { code: 'BIKE', name: 'Bike delivery', description: '', vehicleTypes: ['Motorcycle'], enabled: true, baseFeeMinor: 50_000, perKmMinor: 15_000, minimumFareMinor: 80_000, maxPackageSize: 'MEDIUM' }
const pricing = { enabled: true, currency: 'NGN', services: [service], serviceFee: { type: 'PERCENT', flatMinor: 0, percent: 5 }, serviceArea: { centerLatitude: 5.8916, centerLongitude: 5.6846, radiusKm: 15 }, maxRouteDistanceKm: 40 }

test('parcel price uses road metres, applies the minimum fare and the service fee in integer kobo', () => {
  const short = priceRoute(pricing, service, 1_000)
  assert.equal(short.baseFeeMinor, 50_000)
  assert.equal(short.distanceFeeMinor, 15_000)
  assert.equal(short.minimumFareAdjustmentMinor, 15_000) // 65k fare raised to the 80k minimum
  assert.equal(short.serviceFeeMinor, 4_000)
  assert.equal(short.totalMinor, 84_000)
  const long = priceRoute(pricing, service, 7_350)
  assert.equal(long.distanceFeeMinor, 110_250)
  assert.equal(long.minimumFareAdjustmentMinor, 0)
  assert.equal(long.totalMinor, 160_250 + Math.round(160_250 * 0.05))
  for (const value of Object.values(long)) if (typeof value === 'number') assert.ok(Number.isInteger(value))
  assert.throws(() => priceRoute(pricing, service, 0), /road distance/)
})

test('parcel bookings stay closed until operations publishes fares', () => {
  assert.throws(() => resolveService({ ...pricing, enabled: false }, 'BIKE'), (error) => error.code === 'PARCEL_BOOKINGS_DISABLED')
  assert.throws(() => resolveService(pricing, 'VAN'), (error) => error.code === 'PARCEL_SERVICE_UNAVAILABLE')
  assert.throws(() => resolveService(pricing, 'BIKE', 'LARGE'), (error) => error.code === 'PACKAGE_TOO_LARGE_FOR_SERVICE')
  assert.equal(resolveService(pricing, 'BIKE', 'SMALL').code, 'BIKE')
  assert.equal(parcelPricingSchema.safeParse({ ...pricing, services: [] }).success, false, 'cannot enable bookings with no service')
  assert.equal(parcelPricingSchema.safeParse({ ...pricing, services: [service, service] }).success, false, 'duplicate service codes are rejected')
  assert.equal(parcelPricingSchema.safeParse(pricing).success, true)
})

test('service area check uses the configured radius around Sapele', () => {
  assert.doesNotThrow(() => assertWithinServiceArea(pricing, { latitude: 5.90, longitude: 5.68 }, 'pickup'))
  assert.throws(() => assertWithinServiceArea(pricing, { latitude: 6.45, longitude: 3.39 }, 'pickup'), (error) => error.code === 'OUTSIDE_SERVICE_AREA')
  assert.ok(Math.abs(haversineMeters({ latitude: 5.8916, longitude: 5.6846 }, { latitude: 5.9016, longitude: 5.6846 }) - 1112) < 5)
})

test('road routing never falls back to straight-line distance and hides provider details', async () => {
  const previous = process.env.MAPBOX_SERVER_TOKEN
  try {
    delete process.env.MAPBOX_SERVER_TOKEN
    delete process.env.MAPBOX_TOKEN
    await assert.rejects(fetchRoadRoutes({ latitude: 5.89, longitude: 5.68 }, { latitude: 5.9, longitude: 5.7 }), (error) => error.code === 'ROUTING_NOT_CONFIGURED')
    process.env.MAPBOX_SERVER_TOKEN = 'test-server-token'
    const json = (status, body) => async () => ({ ok: status < 400, status, json: async () => body })
    await assert.rejects(fetchRoadRoutes({ latitude: 5.89, longitude: 5.68 }, { latitude: 5.9, longitude: 5.7 }, { fetchImpl: json(401, { message: 'Not Authorized - Invalid Token' }) }), (error) => error.code === 'ROUTING_TOKEN_REJECTED' && !/test-server-token/.test(error.message))
    await assert.rejects(fetchRoadRoutes({ latitude: 5.89, longitude: 5.68 }, { latitude: 5.9, longitude: 5.7 }, { fetchImpl: json(200, { code: 'NoRoute', routes: [] }) }), (error) => error.code === 'NO_ROAD_ROUTE')
    await assert.rejects(fetchRoadRoutes({ latitude: 5.89, longitude: 5.68 }, { latitude: 5.9, longitude: 5.7 }, { fetchImpl: async () => { throw new Error('offline') } }), (error) => error.code === 'ROUTING_PROVIDER_UNAVAILABLE')
    let requestedUrl = ''
    const routes = await fetchRoadRoutes({ latitude: 5.89, longitude: 5.68 }, { latitude: 5.9, longitude: 5.7 }, { fetchImpl: async (url) => { requestedUrl = url; return { ok: true, status: 200, json: async () => ({ code: 'Ok', routes: [{ distance: 2410.6, duration: 412.2, geometry: { type: 'LineString', coordinates: [[5.68, 5.89], [5.7, 5.9]] } }, { distance: 2900, duration: 380, geometry: { type: 'LineString', coordinates: [[5.68, 5.89], [5.7, 5.9]] } }] }) } } })
    assert.match(requestedUrl, /directions\/v5\/mapbox\/driving\/5\.68,5\.89;5\.7,5\.9/)
    assert.deepEqual(routes.map((route) => [route.id, route.distanceMeters, route.durationSeconds]), [['0', 2411, 412], ['1', 2900, 380]])
  } finally {
    if (previous === undefined) delete process.env.MAPBOX_SERVER_TOKEN
    else process.env.MAPBOX_SERVER_TOKEN = previous
  }
})

test('booking payload validation rejects bad phones, unknown payment methods and extra fields', () => {
  const valid = {
    serviceCode: 'BIKE', routeId: '0', expectedTotalMinor: 84_000, paymentMethod: 'PAYSTACK',
    pickup: { latitude: 5.89, longitude: 5.68, address: 'Okirigwe Road', contactName: 'Ada', contactPhone: '0803 000 0000' },
    dropoff: { latitude: 5.9, longitude: 5.7, address: 'Amukpe Junction' },
    recipient: { name: 'Tobi', phone: '+2348030000001' },
    package: { description: 'Documents', size: 'SMALL' },
  }
  assert.equal(parcelBookingSchema.safeParse(valid).success, true)
  assert.equal(parcelBookingSchema.safeParse({ ...valid, recipient: { name: 'Tobi', phone: 'call me' } }).success, false)
  assert.equal(parcelBookingSchema.safeParse({ ...valid, paymentMethod: 'CASH_ON_DELIVERY' }).success, false)
  assert.equal(parcelBookingSchema.safeParse({ ...valid, totalMinor: 1 }).success, false, 'client-supplied totals are not accepted')
  assert.equal(parcelBookingSchema.safeParse({ ...valid, routeId: '7' }).success, false)
})

test('delivery stages map onto the customer-facing parcel lifecycle', () => {
  assert.equal(parcelStatusByDeliveryStatus.ACCEPTED, 'RIDER_ASSIGNED')
  assert.equal(parcelStatusByDeliveryStatus.GOING_TO_RESTAURANT, 'RIDER_EN_ROUTE_TO_PICKUP')
  assert.equal(parcelStatusByDeliveryStatus.GOING_TO_CUSTOMER, 'IN_TRANSIT')
  assert.equal(parcelStatusByDeliveryStatus.DELIVERED, 'DELIVERED')
  assert.match(parcelReference(new Date('2026-10-19T10:00:00Z')), /^DSP-PKG-20261019-[A-Z2-9]{6}$/)
})

const sampleBooking = (overrides = {}) => ({
  id: 'bk1', reference: 'DSP-PKG-20261019-ABCDEF', customerId: 'cust1', riderId: 'rider1', status: 'RIDER_ASSIGNED', serviceCode: 'BIKE', serviceName: 'Bike delivery',
  pickupAddress: 'A', pickupLatitude: '5.8900000', pickupLongitude: '5.6800000', pickupContactName: 'Ada', pickupContactPhone: '08030000000', pickupNotes: null,
  dropoffAddress: 'B', dropoffLatitude: '5.9000000', dropoffLongitude: '5.7000000', recipientName: 'Tobi', recipientPhone: '08030000001',
  packageDescription: 'Docs', packageSize: 'SMALL', deliveryInstructions: 'Call', distanceMeters: 2411, durationSeconds: 412, routeGeometry: { type: 'LineString', coordinates: [] }, routeProvider: 'mapbox',
  baseFeeMinor: 50_000, distanceFeeMinor: 36_165, minimumFareAdjustmentMinor: 0, serviceFeeMinor: 4_308, totalMinor: 90_473, currency: 'NGN',
  delivery: { id: 'd1', status: 'ACCEPTED', requestExpiresAt: null }, payment: { method: 'PAYSTACK', status: 'SUCCESSFUL', reference: 'DSPPKG-x', instructionsSnapshot: { authorizationUrl: 'https://checkout.paystack.com/x' } },
  rider: { vehicleType: 'Motorcycle', ratingAverage: '4.50', ratingCount: 2, user: { firstName: 'Musa', phone: '08039999999' } }, events: [], riderRating: null, createdAt: new Date(), ...overrides,
})

test('parcel serialization limits contact details and rider phone to the right people', () => {
  const owner = serializeParcel(sampleBooking(), { role: 'CUSTOMER', id: 'cust1' })
  assert.equal(owner.recipient.phone, '08030000001')
  assert.equal(owner.rider.phone, '08039999999')
  assert.equal(owner.payment.status, 'SUCCESSFUL')
  assert.equal(owner.payment.instructions, null, 'Paystack checkout links are not echoed back')
  const openJob = serializeParcel(sampleBooking({ riderId: null, rider: null, delivery: { id: 'd1', status: 'AVAILABLE' } }), { role: 'RIDER', rider: { id: 'rider2' } })
  assert.equal(openJob.recipient, null)
  assert.equal(openJob.pickup.contactPhone, undefined)
  assert.equal(openJob.payment, null)
  const assigned = serializeParcel(sampleBooking(), { role: 'RIDER', rider: { id: 'rider1' } })
  assert.equal(assigned.recipient.name, 'Tobi')
  assert.equal(assigned.payment, null, 'riders never see payment data')
  const finished = serializeParcel(sampleBooking({ status: 'DELIVERED', delivery: { id: 'd1', status: 'DELIVERED' } }), { role: 'CUSTOMER', id: 'cust1' })
  assert.equal(finished.rider.phone, undefined, 'rider phone is withdrawn after delivery')
})

function fakeTransaction(state) {
  return {
    payment: { updateMany: async ({ where, data }) => { if (state.payment.status === 'SUCCESSFUL' && where.status?.not === 'SUCCESSFUL') return { count: 0 }; Object.assign(state.payment, data); return { count: 1 } } },
    parcelBooking: { findUnique: async () => ({ ...state.booking }), update: async ({ data }) => Object.assign(state.booking, data) },
    parcelEvent: { create: async ({ data }) => state.events.push(data.status) },
    delivery: { upsert: async ({ create }) => { state.deliveries += 1; return create } },
    transaction: { create: async ({ data }) => state.ledger.push(data.type) },
    notification: { create: async () => state.notifications++, createMany: async ({ data }) => { state.notifications += data.length } },
    rider: { findMany: async () => [{ userId: 'r1' }, { userId: 'r2' }] },
  }
}

test('verified parcel payments are applied exactly once', async () => {
  const state = { payment: { id: 'p1', status: 'PENDING', amountMinor: 90_473, reference: 'DSPPKG-1', parcelBookingId: 'bk1' }, booking: { id: 'bk1', status: 'PENDING_PAYMENT', customerId: 'c1', reference: 'R', packageSize: 'SMALL', distanceMeters: 2411 }, events: [], deliveries: 0, ledger: [], notifications: 0 }
  const transaction = fakeTransaction(state)
  const first = await confirmParcelPayment(transaction, state.payment, { providerReference: 'DSPPKG-1', source: 'webhook' })
  assert.equal(first.confirmed, true)
  assert.equal(state.booking.status, 'SEARCHING_FOR_RIDER')
  assert.deepEqual(state.events, ['PAYMENT_CONFIRMED', 'SEARCHING_FOR_RIDER'])
  assert.equal(state.deliveries, 1)
  assert.equal(state.notifications, 3, 'customer plus two online riders')
  const second = await confirmParcelPayment(transaction, state.payment, { providerReference: 'DSPPKG-1', source: 'verify' })
  assert.equal(second.duplicate, true)
  assert.equal(state.deliveries, 1)
  const lateOldAttempt = await confirmParcelPayment(transaction, state.payment, { providerReference: 'DSPPKG-OLD', source: 'webhook' })
  assert.equal(lateOldAttempt.duplicate, true)
  assert.ok(state.ledger.includes('DUPLICATE_PAYMENT_REFUND_REQUIRED'), 'a second paid attempt is flagged for refund, not ignored')
})

test('a payment that lands on a cancelled booking is flagged for refund instead of reviving it', async () => {
  const state = { payment: { id: 'p1', status: 'PENDING', amountMinor: 1000, reference: 'R1', parcelBookingId: 'bk1' }, booking: { id: 'bk1', status: 'CANCELLED', customerId: 'c1', reference: 'R', packageSize: 'SMALL', distanceMeters: 1 }, events: [], deliveries: 0, ledger: [], notifications: 0 }
  const outcome = await confirmParcelPayment(fakeTransaction(state), state.payment, { providerReference: 'R1', source: 'webhook' })
  assert.equal(outcome.refundRequired, true)
  assert.equal(state.booking.status, 'CANCELLED')
  assert.equal(state.deliveries, 0)
  assert.ok(state.ledger.includes('REFUND_REQUIRED'))
})

test('frontend source never references server-only secrets', () => {
  const files = []
  const walk = (directory) => { for (const name of readdirSync(directory)) { const path = join(directory, name); if (statSync(path).isDirectory()) walk(path); else if (/\.(jsx?|css|html)$/.test(name)) files.push(path) } }
  walk(fileURLToPath(new URL('../src', import.meta.url)))
  const forbidden = /PAYSTACK_SECRET|sk_(live|test)_[A-Za-z0-9]|MAPBOX_SERVER_TOKEN|DATABASE_URL|AUTH_SECRET|TWILIO_AUTH_TOKEN|RESEND_API_KEY|GOOGLE_NAVIGATION_API_KEY|process\.env/
  for (const file of files) assert.doesNotMatch(readFileSync(file, 'utf8'), forbidden, file)
  const envUses = files.flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/import\.meta\.env\.([A-Z0-9_]+)/g)].map((match) => match[1]))
  for (const name of envUses) assert.match(name, /^VITE_/, `${name} must be a public VITE_ variable`)
})
