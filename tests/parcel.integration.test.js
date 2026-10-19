// End-to-end parcel flow against a real PostgreSQL database.
// Opt-in only: it writes test rows. Point it at a development database that has
// all migrations applied:
//   DOORSTEP_INTEGRATION_DATABASE_URL=postgresql://... node --test tests/parcel.integration.test.js
// Mapbox and Paystack are replaced with local stubs, so no real money moves and no
// Mapbox quota is used; this verifies DOORSTEP's own server logic and database rules.
import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'

const databaseUrl = process.env.DOORSTEP_INTEGRATION_DATABASE_URL
const skip = !databaseUrl && 'set DOORSTEP_INTEGRATION_DATABASE_URL to run the database-backed parcel flow'

let request, app, prisma, createSession
const run = randomUUID().slice(0, 8)
const ids = {}
const tokens = {}
const PAYSTACK_SECRET = 'sk_test_integration_only'
const realFetch = globalThis.fetch
const paystackState = new Map()

function stubFetch(url, options = {}) {
  const href = String(url)
  if (href.startsWith('https://api.mapbox.com/directions/')) {
    return Promise.resolve(new Response(JSON.stringify({ code: 'Ok', routes: [
      { distance: 3200, duration: 540, geometry: { type: 'LineString', coordinates: [[5.68, 5.89], [5.69, 5.895], [5.70, 5.90]] } },
      { distance: 4100, duration: 600, geometry: { type: 'LineString', coordinates: [[5.68, 5.89], [5.70, 5.89], [5.70, 5.90]] } },
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  }
  if (href === 'https://api.paystack.co/transaction/initialize') {
    const body = JSON.parse(options.body)
    paystackState.set(body.reference, { amount: body.amount, status: 'abandoned' })
    return Promise.resolve(new Response(JSON.stringify({ status: true, data: { authorization_url: `https://checkout.paystack.com/${body.reference}`, access_code: 'x' } }), { status: 200 }))
  }
  if (href.startsWith('https://api.paystack.co/transaction/verify/')) {
    const reference = decodeURIComponent(href.split('/').pop())
    const known = paystackState.get(reference)
    if (!known) return Promise.resolve(new Response(JSON.stringify({ status: false, message: 'Transaction reference not found' }), { status: 404 }))
    return Promise.resolve(new Response(JSON.stringify({ status: true, data: { status: known.status, reference, amount: known.amount, currency: 'NGN', id: 1 } }), { status: 200 }))
  }
  return realFetch(url, options)
}

const auth = (name) => ({ Authorization: `Bearer ${tokens[name]}` })

before(async () => {
  if (skip) return
  process.env.DATABASE_URL = databaseUrl
  process.env.NODE_ENV = 'test'
  process.env.PAYSTACK_SECRET_KEY = PAYSTACK_SECRET
  process.env.MAPBOX_SERVER_TOKEN = 'integration-stub-token'
  globalThis.fetch = stubFetch
  request = (await import('supertest')).default
  ;({ app } = await import('../server/index.js'))
  ;({ prisma } = await import('../server/prisma.js'))
  ;({ createSession } = await import('../server/auth.js'))
  const make = async (role, extra = {}) => prisma.user.create({ data: { email: `parcel-${role.toLowerCase()}-${run}-${Math.random().toString(36).slice(2, 6)}@test.doorstep.invalid`, passwordHash: 'x:y', role, firstName: `${role[0]}${role.slice(1).toLowerCase()}`, lastName: 'Test', ...extra } })
  const customer = await make('CUSTOMER', { phone: `+23480${run.replace(/\D/g, '').padEnd(8, '1').slice(0, 8)}` })
  const stranger = await make('CUSTOMER')
  const admin = await make('ADMIN')
  const riderUser = await make('RIDER', { firstName: 'Musa' })
  const rider = await prisma.rider.create({ data: { userId: riderUser.id, status: 'APPROVED', availability: 'ONLINE', network: 'DOORSTEP_POOL', vehicleType: 'Motorcycle', availabilityLatitude: 5.889, availabilityLongitude: 5.679, availabilityLocatedAt: new Date() } })
  Object.assign(ids, { customer: customer.id, stranger: stranger.id, admin: admin.id, riderUser: riderUser.id, rider: rider.id })
  for (const [name, id] of Object.entries({ customer: customer.id, stranger: stranger.id, admin: admin.id, rider: riderUser.id })) tokens[name] = await createSession(id)
  ids.previousPricing = await prisma.platformSetting.findUnique({ where: { key: 'parcel_pricing' } })
})

after(async () => {
  if (skip) return
  globalThis.fetch = realFetch
  const bookings = await prisma.parcelBooking.findMany({ where: { customerId: { in: [ids.customer, ids.stranger].filter(Boolean) } }, select: { id: true, payment: { select: { id: true } } } })
  const paymentIds = bookings.map((booking) => booking.payment?.id).filter(Boolean)
  await prisma.transaction.deleteMany({ where: { paymentId: { in: paymentIds } } })
  await prisma.riderLocation.deleteMany({ where: { riderId: ids.rider } })
  await prisma.parcelBooking.deleteMany({ where: { id: { in: bookings.map((booking) => booking.id) } } })
  await prisma.auditLog.deleteMany({ where: { actorId: ids.admin } })
  if (ids.previousPricing) await prisma.platformSetting.update({ where: { key: 'parcel_pricing' }, data: { value: ids.previousPricing.value } })
  else await prisma.platformSetting.deleteMany({ where: { key: 'parcel_pricing' } })
  await prisma.user.deleteMany({ where: { id: { in: [ids.customer, ids.stranger, ids.admin, ids.riderUser].filter(Boolean) } } })
  await prisma.$disconnect()
})

const pickup = { latitude: 5.8900, longitude: 5.6800 }
const dropoff = { latitude: 5.9000, longitude: 5.7000 }

test('parcel booking, payment, rider assignment, tracking and access control', { skip }, async () => {
  // Bookings are closed until fares are published.
  const closed = await request(app).post('/api/parcels/quote').set(auth('customer')).send({ pickup, dropoff, serviceCode: 'BIKE' })
  if (!ids.previousPricing?.value?.enabled) assert.equal(closed.body.error, 'PARCEL_BOOKINGS_DISABLED')

  const pricing = { enabled: true, currency: 'NGN', services: [{ code: 'BIKE', name: 'Bike delivery', description: 'Test', vehicleTypes: ['Motorcycle'], enabled: true, baseFeeMinor: 50_000, perKmMinor: 10_000, minimumFareMinor: 60_000, maxPackageSize: 'MEDIUM' }], serviceFee: { type: 'FLAT', flatMinor: 5_000, percent: 0 }, serviceArea: { centerLatitude: 5.8916, centerLongitude: 5.6846, radiusKm: 20 }, maxRouteDistanceKm: 30 }
  assert.equal((await request(app).patch('/api/admin/parcel-pricing').set(auth('customer')).send(pricing)).status, 403)
  const saved = await request(app).patch('/api/admin/parcel-pricing').set(auth('admin')).send(pricing)
  assert.equal(saved.status, 200, JSON.stringify(saved.body))

  const quote = await request(app).post('/api/parcels/quote').set(auth('customer')).send({ pickup, dropoff, serviceCode: 'BIKE', packageSize: 'SMALL' })
  assert.equal(quote.status, 200, JSON.stringify(quote.body))
  assert.equal(quote.body.routes.length, 2)
  assert.equal(quote.body.routes[0].price.totalMinor, 50_000 + 32_000 + 5_000)
  assert.equal((await request(app).post('/api/parcels/quote').set(auth('customer')).send({ pickup, dropoff: { latitude: 6.45, longitude: 3.39 }, serviceCode: 'BIKE' })).body.error, 'OUTSIDE_SERVICE_AREA')

  const payload = { serviceCode: 'BIKE', routeId: '0', expectedTotalMinor: 1, paymentMethod: 'PAYSTACK', pickup: { ...pickup, address: 'Test pickup', contactName: 'Ada', contactPhone: '08030000000' }, dropoff: { ...dropoff, address: 'Test dropoff' }, recipient: { name: 'Tobi', phone: '08030000001' }, package: { description: 'Envelope', size: 'SMALL' } }
  const stale = await request(app).post('/api/parcels').set(auth('customer')).send(payload)
  assert.equal(stale.status, 409)
  assert.equal(stale.body.error, 'PRICE_CHANGED')
  const key = `integration-${randomUUID()}`
  const created = await request(app).post('/api/parcels').set(auth('customer')).set('Idempotency-Key', key).send({ ...payload, expectedTotalMinor: 87_000 })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  const booking = created.body.booking
  assert.equal(booking.status, 'PENDING_PAYMENT')
  assert.equal(booking.price.totalMinor, 87_000)
  const replay = await request(app).post('/api/parcels').set(auth('customer')).set('Idempotency-Key', key).send({ ...payload, expectedTotalMinor: 87_000 })
  assert.equal(replay.body.duplicate, true)
  assert.equal(replay.body.booking.id, booking.id)

  // Other customers cannot see or act on it.
  assert.equal((await request(app).get(`/api/parcels/${booking.id}`).set(auth('stranger'))).status, 404)
  assert.equal((await request(app).post(`/api/parcels/${booking.id}/cancel`).set(auth('stranger')).send({})).status, 404)
  assert.equal((await request(app).get(`/api/parcels/${booking.id}`).set(auth('rider'))).status, 404, 'riders cannot read unassigned bookings')

  const pay = await request(app).post(`/api/parcels/${booking.id}/pay`).set(auth('customer'))
  assert.equal(pay.status, 200, JSON.stringify(pay.body))
  assert.match(pay.body.authorizationUrl, /^https:\/\/checkout\.paystack\.com\//)
  const reference = pay.body.reference
  const again = await request(app).post(`/api/parcels/${booking.id}/pay`).set(auth('customer'))
  assert.equal(again.body.authorizationUrl, pay.body.authorizationUrl, 'a pending checkout is reused, not re-created')

  // A forged webhook is rejected; a wrong amount is not applied.
  const forged = JSON.stringify({ event: 'charge.success', data: { reference, amount: 87_000, currency: 'NGN' } })
  assert.equal((await request(app).post('/api/payments/webhook').set('Content-Type', 'application/json').set('x-paystack-signature', 'bad').send(forged)).status, 401)
  const sign = (body) => createHmac('sha512', PAYSTACK_SECRET).update(body).digest('hex')
  const wrongAmount = JSON.stringify({ event: 'charge.success', data: { reference, amount: 1_000, currency: 'NGN', id: 9 } })
  assert.equal((await request(app).post('/api/payments/webhook').set('Content-Type', 'application/json').set('x-paystack-signature', sign(wrongAmount)).send(wrongAmount)).status, 400)
  assert.equal((await prisma.payment.findUnique({ where: { parcelBookingId: booking.id } })).status, 'AMOUNT_MISMATCH')
  await prisma.payment.update({ where: { parcelBookingId: booking.id }, data: { status: 'PENDING' } })

  // The callback page verifies with Paystack server-to-server.
  paystackState.set(reference, { amount: 87_000, status: 'success' })
  const verified = await request(app).post('/api/payments/verify').set(auth('customer')).send({ reference })
  assert.equal(verified.status, 200, JSON.stringify(verified.body))
  assert.equal(verified.body.status, 'SUCCESSFUL')
  assert.equal((await request(app).post('/api/payments/verify').set(auth('stranger')).send({ reference })).status, 404)
  const good = JSON.stringify({ event: 'charge.success', data: { reference, amount: 87_000, currency: 'NGN', id: 1 } })
  const duplicateWebhook = await request(app).post('/api/payments/webhook').set('Content-Type', 'application/json').set('x-paystack-signature', sign(good)).send(good)
  assert.equal(duplicateWebhook.status, 200)
  assert.equal(await prisma.delivery.count({ where: { parcelBookingId: booking.id } }), 1, 'one delivery even after verify + webhook')

  const searching = (await request(app).get(`/api/parcels/${booking.id}`).set(auth('customer'))).body.booking
  assert.equal(searching.status, 'SEARCHING_FOR_RIDER')
  assert.equal(searching.permissions.canEdit, false)

  const riders = await request(app).get(`/api/parcels/${booking.id}/riders`).set(auth('customer'))
  assert.equal(riders.status, 200)
  const listed = riders.body.riders.find((item) => item.id === ids.rider)
  assert.ok(listed, 'the approved online rider is listed')
  assert.equal(listed.rating, null, 'no invented rating for a rider with no ratings')
  assert.equal(listed.arrival.etaSeconds, 540, 'arrival estimate comes from the road route')
  assert.equal(listed.latitude, undefined, 'precise rider location is not exposed')

  const requested = await request(app).post(`/api/parcels/${booking.id}/request-rider`).set(auth('customer')).send({ riderId: ids.rider })
  assert.equal(requested.status, 200, JSON.stringify(requested.body))
  assert.equal((await request(app).post(`/api/parcels/${booking.id}/request-rider`).set(auth('customer')).send({ riderId: ids.rider })).body.error, 'RIDER_REQUEST_PENDING')

  const jobs = await request(app).get('/api/rider/parcel-jobs').set(auth('rider'))
  const job = jobs.body.jobs.find((item) => item.booking.id === booking.id)
  assert.equal(job.kind, 'REQUESTED_FOR_YOU')
  assert.equal(job.booking.recipient, null, 'recipient phone hidden until accepted')
  const accepted = await request(app).post(`/api/deliveries/${job.deliveryId}/accept`).set(auth('rider'))
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body))
  assert.equal((await prisma.parcelBooking.findUnique({ where: { id: booking.id } })).status, 'RIDER_ASSIGNED')

  for (const status of ['GOING_TO_RESTAURANT', 'ARRIVED_AT_RESTAURANT']) assert.equal((await request(app).post(`/api/deliveries/${job.deliveryId}/status`).set(auth('rider')).send({ status })).status, 200)
  assert.equal((await request(app).post(`/api/deliveries/${job.deliveryId}/status`).set(auth('rider')).send({ status: 'DELIVERED' })).status, 409, 'stages cannot be skipped')

  const located = await request(app).post(`/api/deliveries/${job.deliveryId}/location`).set(auth('rider')).send({ latitude: 5.8905, longitude: 5.6810, accuracy: 12, timestamp: Date.now() })
  assert.equal(located.status, 202)
  const tracking = await request(app).get(`/api/deliveries/${job.deliveryId}/tracking`).set(auth('customer'))
  assert.equal(tracking.body.kind, 'parcel')
  assert.equal(Number(tracking.body.delivery.location.latitude), 5.8905)
  assert.equal((await request(app).get(`/api/deliveries/${job.deliveryId}/tracking`).set(auth('stranger'))).status, 403)

  for (const status of ['PICKED_UP', 'GOING_TO_CUSTOMER']) assert.equal((await request(app).post(`/api/deliveries/${job.deliveryId}/status`).set(auth('rider')).send({ status })).status, 200)
  assert.equal((await request(app).post(`/api/parcels/${booking.id}/cancel`).set(auth('customer')).send({})).body.error, 'PARCEL_NOT_CANCELLABLE', 'no cancelling after pickup')
  assert.equal((await request(app).post(`/api/deliveries/${job.deliveryId}/status`).set(auth('rider')).send({ status: 'DELIVERED' })).status, 200)

  const done = (await request(app).get(`/api/parcels/${booking.id}`).set(auth('customer'))).body.booking
  assert.equal(done.status, 'DELIVERED')
  assert.deepEqual(done.events.map((event) => event.status).filter((status, index, list) => list.indexOf(status) === index), ['PENDING_PAYMENT', 'PAYMENT_CONFIRMED', 'SEARCHING_FOR_RIDER', 'RIDER_ASSIGNED', 'RIDER_EN_ROUTE_TO_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED'])
  assert.equal(done.rider.phone, undefined)
  assert.equal((await request(app).get(`/api/deliveries/${job.deliveryId}/tracking`).set(auth('customer'))).body.delivery.location, null, 'location withdrawn after delivery')

  assert.equal((await request(app).post(`/api/parcels/${booking.id}/rate`).set(auth('customer')).send({ rating: 5 })).status, 200)
  assert.equal((await request(app).post(`/api/parcels/${booking.id}/rate`).set(auth('customer')).send({ rating: 1 })).body.error, 'ALREADY_RATED')
  const rider = await prisma.rider.findUnique({ where: { id: ids.rider } })
  assert.equal(rider.ratingCount, 1)
  assert.equal(Number(rider.ratingAverage), 5)
})

test('cancelling a paid booking before pickup flags a refund and frees the rider', { skip }, async () => {
  const quote = await request(app).post('/api/parcels/quote').set(auth('customer')).send({ pickup, dropoff, serviceCode: 'BIKE', packageSize: 'SMALL' })
  const created = await request(app).post('/api/parcels').set(auth('customer')).send({ serviceCode: 'BIKE', routeId: '1', expectedTotalMinor: quote.body.routes[1].price.totalMinor, paymentMethod: 'PAYSTACK', pickup: { ...pickup, address: 'P', contactName: 'Ada', contactPhone: '08030000000' }, dropoff: { ...dropoff, address: 'D' }, recipient: { name: 'Tobi', phone: '08030000001' }, package: { description: 'Box', size: 'SMALL' } })
  assert.equal(created.status, 201)
  const id = created.body.booking.id
  const edited = await request(app).patch(`/api/parcels/${id}`).set(auth('customer')).send({ recipient: { name: 'Tobi Updated' } })
  assert.equal(edited.body.booking.recipient.name, 'Tobi Updated')
  const pay = await request(app).post(`/api/parcels/${id}/pay`).set(auth('customer'))
  paystackState.set(pay.body.reference, { amount: quote.body.routes[1].price.totalMinor, status: 'success' })
  assert.equal((await request(app).post('/api/payments/verify').set(auth('customer')).send({ reference: pay.body.reference })).body.status, 'SUCCESSFUL')
  const jobs = await request(app).get('/api/rider/parcel-jobs').set(auth('rider'))
  const open = jobs.body.jobs.find((item) => item.booking.id === id)
  assert.equal(open.kind, 'OPEN')
  assert.equal((await request(app).post(`/api/deliveries/${open.deliveryId}/accept`).set(auth('rider'))).status, 200)
  const cancelled = await request(app).post(`/api/parcels/${id}/cancel`).set(auth('customer')).send({ reason: 'Changed plans' })
  assert.equal(cancelled.status, 200)
  assert.equal(cancelled.body.refundReview, true)
  const payment = await prisma.payment.findUnique({ where: { parcelBookingId: id }, include: { transactions: true } })
  assert.ok(payment.transactions.some((entry) => entry.type === 'REFUND_REQUIRED'))
  assert.equal((await prisma.delivery.findUnique({ where: { parcelBookingId: id } })).status, 'CANCELLED')
})
