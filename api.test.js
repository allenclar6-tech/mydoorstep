import assert from 'node:assert/strict'
import { test } from 'node:test'
import request from 'supertest'
import { isOrderPayable, matchesPaystackPayment, verifyWebhookSignature } from '../server/paymentService.js'

process.env.NODE_ENV = 'test'
const { app } = await import('../server/index.js')

test('health endpoint reports API availability', async () => {
  const response = await request(app).get('/api/health')
  assert.equal(response.status, 200)
  assert.equal(response.body.status, 'ok')
})

test('database health endpoint reports database availability without secrets', async () => {
  const response = await request(app).get('/api/health/database')
  assert.ok([200, 503].includes(response.status))
  assert.ok(['ok', 'unavailable'].includes(response.body.database))
  assert.equal(response.body.databaseUrl, undefined)
})

test('disallowed browser origins receive a JSON CORS error', async () => {
  const response = await request(app).get('/api/health').set('Origin', 'https://not-doorstep.example')
  assert.equal(response.status, 403)
  assert.equal(response.body.error, 'CORS_ORIGIN_NOT_ALLOWED')
})

test('malformed JSON receives a stable JSON error response', async () => {
  const response = await request(app).post('/api/support/ai').set('Content-Type', 'application/json').send('{"message":')
  assert.equal(response.status, 400)
  assert.equal(response.body.error, 'INVALID_JSON')
})

test('public service areas expose the enabled Sapele operating area', async () => {
  const response = await request(app).get('/api/service-areas')
  assert.equal(response.status, 200)
  assert.match(response.headers['cache-control'], /max-age=60/)
  assert.ok(response.body.serviceAreas.some((area) => area.city === 'Sapele'))
})

test('readiness endpoint reports database availability separately', async () => {
  const response = await request(app).get('/api/ready')
  assert.ok([200, 503].includes(response.status))
  assert.ok(['ready', 'not_ready'].includes(response.body.status))
  assert.ok(['ok', 'unavailable'].includes(response.body.database))
})

test('delivery claim requires authentication', async () => {
  const response = await request(app).post('/api/deliveries/example/claim')
  assert.equal(response.status, 401)
  assert.equal(response.body.error, 'AUTHENTICATION_REQUIRED')
})

test('partner application validates required identity fields', async () => {
  const response = await request(app).post('/api/partner-applications').send({})
  assert.equal(response.status, 400)
  assert.equal(response.body.error, 'INVALID_PARTNER_APPLICATION')
})

test('multipart partner applications require private verification documents', async () => {
  const response = await request(app).post('/api/partner-applications/multipart').field('restaurantName', 'Test Kitchen')
  assert.equal(response.status, 400)
  assert.equal(response.body.error, 'INVALID_PARTNER_APPLICATION')
})

test('public support AI returns a grounded marketplace response', async () => {
  const response = await request(app).post('/api/support/ai').send({ message: 'Where can I get suya?' })
  assert.equal(response.status, 200)
  assert.match(response.body.reply, /Firewood Grill/)
  assert.match(response.body.reply, /N5,000/)
})

test('payment configuration uses the documented provider variable', async () => {
  const response = await request(app).get('/api/payments/config')
  assert.equal(response.status, 200)
  assert.equal(response.body.provider, process.env.PAYMENT_PROVIDER || process.env.PAYMENTS_PROVIDER || 'paystack')
})

test('admin summary requires authentication', async () => {
  const response = await request(app).get('/api/admin/summary')
  assert.equal(response.status, 401)
  assert.equal(response.body.error, 'AUTHENTICATION_REQUIRED')
})

test('payment webhook reconciliation requires the stored amount and NGN currency', () => {
  const payment = { reference: 'pending_order', amountMinor: 125000 }
  assert.equal(matchesPaystackPayment(payment, { data: { reference: 'pending_order', amount: 125000, currency: 'NGN' } }), true)
  assert.equal(matchesPaystackPayment(payment, { data: { reference: 'pending_order', amount: 125001, currency: 'NGN' } }), false)
  assert.equal(matchesPaystackPayment(payment, { data: { reference: 'pending_order', amount: 125000, currency: 'USD' } }), false)
})

test('payment confirmation only applies to payable order states', () => {
  assert.equal(isOrderPayable('PENDING_PAYMENT'), true)
  assert.equal(isOrderPayable('PAID'), true)
  assert.equal(isOrderPayable('CANCELLED'), false)
  assert.equal(isOrderPayable('REFUNDED'), false)
  assert.equal(isOrderPayable('DELIVERED'), false)
})

test('webhook signature verification fails closed for malformed raw bodies', () => {
  assert.equal(verifyWebhookSignature(undefined, 'signature'), false)
  assert.equal(verifyWebhookSignature('not-a-buffer', 'signature'), false)
})

test('operational restaurant and rider APIs require their roles', async () => {
  const restaurantResponse = await request(app).get('/api/restaurant/orders')
  const riderResponse = await request(app).get('/api/rider/deliveries')
  assert.equal(restaurantResponse.status, 401)
  assert.equal(riderResponse.status, 401)
})
