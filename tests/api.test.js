import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import request from 'supertest'
import { validateLocationUpdate } from '../server/deliveryService.js'
import { isOrderPayable, matchesPaystackPayment, verifyWebhookSignature } from '../server/paymentService.js'
import { verificationFailure } from '../server/verificationService.js'
import { applicationSubmissionError, validateOpeningHours } from '../src/applicationValidation.js'

process.env.NODE_ENV = 'test'
const { app, addressSchema, orderSchema, storeApplicationDocuments } = await import('../server/index.js')

test('deployment environment variables take precedence over .env values', () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'doorstep-env-test-'))
  try {
    writeFileSync(join(temporaryDirectory, '.env'), 'PAYMENT_PROVIDER=dotenv-value\n')
    const serverEntry = new URL('../server/index.js', import.meta.url).href
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', `await import(${JSON.stringify(serverEntry)}); process.stdout.write(process.env.PAYMENT_PROVIDER)`],
      {
        cwd: temporaryDirectory,
        encoding: 'utf8',
        env: { ...process.env, NODE_ENV: 'test', PAYMENT_PROVIDER: 'deployment-value' },
        timeout: 30000,
      },
    )
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim().split(/\r?\n/).at(-1), 'deployment-value')
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
})

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

test('configured public web origins can call the API', async () => {
  const originalOrigins = process.env.WEB_ORIGINS
  process.env.WEB_ORIGINS = 'https://mydoorstep-site-20260922.eyedofejiro10.workers.dev'
  try {
    const response = await request(app).get('/api/health').set('Origin', process.env.WEB_ORIGINS)
    assert.equal(response.status, 200)
    assert.equal(response.headers['access-control-allow-origin'], process.env.WEB_ORIGINS)
  } finally {
    if (originalOrigins === undefined) delete process.env.WEB_ORIGINS
    else process.env.WEB_ORIGINS = originalOrigins
  }
})

test('deployed Render storefront can preflight verification requests', async () => {
  const response = await request(app)
    .options('/api/auth/verification/request')
    .set('Origin', 'https://mydoorstep-web.onrender.com')
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'content-type')
  assert.equal(response.status, 204)
  assert.equal(response.headers['access-control-allow-origin'], 'https://mydoorstep-web.onrender.com')
  assert.match(response.headers['access-control-allow-methods'], /POST/)
})

test('custom storefront can preflight verification requests', async () => {
  const response = await request(app)
    .options('/api/auth/verification/request')
    .set('Origin', 'https://mydoorstep.com.co')
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'content-type')
  assert.equal(response.status, 204)
  assert.equal(response.headers['access-control-allow-origin'], 'https://mydoorstep.com.co')
  assert.match(response.headers['access-control-allow-methods'], /POST/)
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

test('Google location search remains unavailable without a configured server key', { skip: Boolean(process.env.GOOGLE_MAPS_API_KEY) }, async () => {
  const response = await request(app).get('/api/locations/google/autocomplete').query({ query: 'Amukpe, Sapele' })
  assert.equal(response.status, 503)
  assert.equal(response.body.error, 'GOOGLE_PLACES_UNAVAILABLE')
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

test('live delivery locations require authenticated rider sessions', async () => {
  const response = await request(app).post('/api/deliveries/example/location').send({
    latitude: 5.89,
    longitude: 5.67,
    accuracy: 12,
    timestamp: new Date().toISOString(),
  })
  assert.equal(response.status, 401)
  assert.equal(response.body.error, 'AUTHENTICATION_REQUIRED')
})

test('delivery location validation rejects invalid accuracy and stale timestamps', () => {
  const now = Date.now()
  assert.throws(
    () => validateLocationUpdate({ latitude: 5.89, longitude: 5.67, accuracy: 101, timestamp: new Date(now).toISOString() }, now),
    { code: 'INVALID_LOCATION_ACCURACY' },
  )
  assert.throws(
    () => validateLocationUpdate({ latitude: 5.89, longitude: 5.67, accuracy: 12, timestamp: new Date(now - 300001).toISOString() }, now),
    { code: 'STALE_LOCATION' },
  )
})

test('delivery location validation retains only current, accurate coordinates', () => {
  const now = Date.now()
  const update = validateLocationUpdate({ latitude: 5.89, longitude: 5.67, accuracy: 12, timestamp: new Date(now).toISOString() }, now)
  assert.equal(update.latitude, 5.89)
  assert.equal(update.longitude, 5.67)
  assert.equal(update.accuracy, 12)
})

test('partner application validates required core fields', async () => {
  const response = await request(app).post('/api/partner-applications').send({})
  assert.equal(response.status, 400)
  assert.equal(response.body.error, 'INVALID_PARTNER_APPLICATION')
  assert.ok(response.body.details.fieldErrors.verificationId)
})

test('partner application rejects one-sided opening hours with an actionable field error', async () => {
  const response = await request(app).post('/api/partner-applications/multipart')
    .field('restaurantName', 'Test Kitchen')
    .field('businessPhone', '+2348012345678')
    .field('businessEmail', 'owner@example.com')
    .field('address', '12 Test Street, Sapele')
    .field('cityName', 'Sapele')
    .field('ownerName', 'Test Owner')
    .field('deliveryPreference', 'DOORSTEP_RIDERS')
    .field('openingTime', '09:00')
    .field('verificationId', 'unverified-challenge')
    .field('password', 'secure-password')
    .field('confirmPassword', 'secure-password')
    .field('termsAccepted', 'on')
  assert.equal(response.status, 400)
  assert.equal(response.body.error, 'INVALID_PARTNER_APPLICATION')
  assert.deepEqual(response.body.details.fieldErrors.openingTime, ['Provide both opening and closing times.'])
})

test('onboarding blocks one-sided opening hours and clears the constraint when completed', () => {
  const fields = {
    openingTime: { value: '09:00', setCustomValidity(message) { this.validationMessage = message }, reportValidity() { this.reported = true } },
    closingTime: { value: '', setCustomValidity(message) { this.validationMessage = message }, reportValidity() { this.reported = true } },
  }
  const form = { elements: { namedItem: (name) => fields[name] } }

  assert.equal(validateOpeningHours(form), false)
  assert.equal(fields.closingTime.validationMessage, 'Enter both opening and closing times.')
  assert.equal(fields.closingTime.reported, true)

  fields.closingTime.value = '17:00'
  assert.equal(validateOpeningHours(form), true)
  assert.equal(fields.openingTime.validationMessage, '')
  assert.equal(fields.closingTime.validationMessage, '')
})

test('application errors show safe server validation details instead of machine codes', () => {
  const form = { elements: { namedItem: (name) => name === 'openingTime' ? { labels: [{ textContent: 'Opening time' }] } : null } }
  const message = applicationSubmissionError({
    error: 'INVALID_PARTNER_APPLICATION',
    details: { fieldErrors: { openingTime: ['Provide both opening and closing times.'] } },
  }, form, 'Could not submit the application.')

  assert.equal(message, 'Opening and closing times: Provide both opening and closing times.')
})

test('partner application cannot attach a private document from a client-supplied storage key', async () => {
  const response = await request(app).post('/api/partner-applications').send({
    restaurantName: 'Test Kitchen',
    businessPhone: '+2348012345678',
    businessEmail: 'owner@example.com',
    address: '12 Test Street, Sapele',
    ownerName: 'Test Owner',
    verificationId: 'unverified-challenge',
    password: 'secure-password',
    confirmPassword: 'secure-password',
    deliveryPreference: 'DOORSTEP_RIDERS',
    termsAccepted: true,
    documents: [{ type: 'IDENTITY', storageKey: 'private/applications/another-applicant/id.pdf' }],
  })
  assert.equal(response.status, 400)
  assert.equal(response.body.error, 'INVALID_PARTNER_APPLICATION')
})

test('partner applications reject creation until an email verification challenge is supplied', async () => {
  const response = await request(app).post('/api/partner-applications/multipart')
    .field('restaurantName', 'Test Kitchen')
    .field('businessPhone', '+2348012345678')
    .field('businessEmail', 'owner@example.com')
    .field('address', '12 Test Street, Sapele')
    .field('ownerName', 'Test Owner')
    .field('password', 'secure-password')
    .field('confirmPassword', 'secure-password')
    .field('deliveryPreference', 'DOORSTEP_RIDERS')
    .field('termsAccepted', 'on')
  assert.equal(response.status, 400)
  assert.equal(response.body.error, 'INVALID_PARTNER_APPLICATION')
})

test('grocery applications reject creation until an email verification challenge is supplied', async () => {
  const response = await request(app).post('/api/grocery-applications/multipart')
    .field('groceryName', 'Test Grocer')
    .field('restaurantName', 'Test Grocer')
    .field('businessPhone', '+2348012345678')
    .field('businessEmail', 'grocer@example.com')
    .field('address', '12 Test Street, Sapele')
    .field('ownerName', 'Test Owner')
    .field('password', 'secure-password')
    .field('confirmPassword', 'secure-password')
    .field('deliveryPreference', 'DOORSTEP_RIDERS')
    .field('termsAccepted', 'on')
  assert.equal(response.status, 400)
  assert.equal(response.body.error, 'INVALID_GROCERY_APPLICATION')
  assert.ok(response.body.details.fieldErrors.verificationId)
})

test('rider applications reject creation until an email verification challenge is supplied', async () => {
  const response = await request(app).post('/api/rider-applications/multipart')
    .field('firstName', 'Test')
    .field('lastName', 'Rider')
    .field('email', 'rider@example.com')
    .field('phone', '+2348012345678')
    .field('address', '12 Test Street, Sapele')
    .field('preferredArea', 'Amukpe, Sapele')
    .field('vehicleType', 'motorcycle')
    .field('vehicleOwnership', 'OWNED')
    .field('typicalAvailability', 'Weekdays, evenings')
    .field('password', 'secure-password')
    .field('confirmPassword', 'secure-password')
    .field('termsAccepted', 'on')
  assert.equal(response.status, 400)
  assert.equal(response.body.error, 'INVALID_RIDER_APPLICATION')
})

test('partner application passwords must match before verification or persistence', async () => {
  const response = await request(app).post('/api/partner-applications/multipart')
    .field('restaurantName', 'Test Kitchen')
    .field('businessPhone', '+2348012345678')
    .field('businessEmail', 'owner@example.com')
    .field('address', '12 Test Street, Sapele')
    .field('ownerName', 'Test Owner')
    .field('deliveryPreference', 'DOORSTEP_RIDERS')
    .field('verificationId', 'unverified-challenge')
    .field('password', 'secure-password')
    .field('confirmPassword', 'different-password')
    .field('termsAccepted', 'on')
  assert.equal(response.status, 400)
  assert.equal(response.body.error, 'PASSWORD_CONFIRMATION_MISMATCH')
})

test('grocery application requires applicant agreement before verification or persistence', async () => {
  const response = await request(app).post('/api/grocery-applications/multipart')
    .field('restaurantName', 'Test Grocer')
    .field('groceryName', 'Test Grocer')
    .field('businessPhone', '+2348012345678')
    .field('businessEmail', 'grocer@example.com')
    .field('address', '12 Test Street, Sapele')
    .field('ownerName', 'Test Owner')
    .field('verificationId', 'unverified-challenge')
    .field('password', 'secure-password')
    .field('confirmPassword', 'secure-password')
    .field('deliveryPreference', 'DOORSTEP_RIDERS')
  assert.equal(response.status, 400)
  assert.equal(response.body.error, 'INVALID_GROCERY_APPLICATION')
  assert.ok(response.body.details.fieldErrors.termsAccepted)
})

test('application document handling safely accepts no uploads', async () => {
  assert.deepEqual(await storeApplicationDocuments(), [])
  assert.deepEqual(await storeApplicationDocuments([]), [])
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
  assert.equal(response.body.publicKey, undefined)
  assert.equal(typeof response.body.methods?.paystack?.enabled, 'boolean')
  assert.equal(typeof response.body.methods?.bankTransfer?.enabled, 'boolean')
})

test('admin summary requires authentication', async () => {
  const response = await request(app).get('/api/admin/summary')
  assert.equal(response.status, 401)
  assert.equal(response.body.error, 'AUTHENTICATION_REQUIRED')
})

test('customer order history and order tracking require authentication', async () => {
  const historyResponse = await request(app).get('/api/orders')
  const trackingResponse = await request(app).get('/api/orders/example-order/tracking')
  assert.equal(historyResponse.status, 401)
  assert.equal(historyResponse.body.error, 'AUTHENTICATION_REQUIRED')
  assert.equal(trackingResponse.status, 401)
  assert.equal(trackingResponse.body.error, 'AUTHENTICATION_REQUIRED')
})

test('saved addresses and orders accept complete map coordinates but reject partial or invalid points', () => {
  const address = { label: 'Home', addressLine: '12 Example Road, Sapele' }
  const order = { restaurantId: 'restaurant-1', items: [{ menuItemId: 'meal-1', quantity: 1 }], addressLine: address.addressLine }
  for (const schema of [addressSchema, orderSchema]) {
    const base = schema === addressSchema ? address : order
    assert.equal(schema.safeParse(base).success, true)
    assert.equal(schema.safeParse({ ...base, latitude: 5.8916123, longitude: 5.6846234 }).success, true)
    assert.equal(schema.safeParse({ ...base, latitude: 5.8916123 }).success, false)
    assert.equal(schema.safeParse({ ...base, latitude: 95, longitude: 5.6846234 }).success, false)
  }
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

test('verification failures expose only stable, safe provider states', () => {
  assert.deepEqual(verificationFailure({ code: 'EMAIL_VERIFICATION_NOT_CONFIGURED', status: 503 }), { code: 'EMAIL_VERIFICATION_NOT_CONFIGURED', status: 503 })
  assert.deepEqual(verificationFailure({ code: 'EMAIL_VERIFICATION_RATE_LIMITED', status: 429 }), { code: 'EMAIL_VERIFICATION_RATE_LIMITED', status: 429 })
  assert.deepEqual(verificationFailure({ code: 'SMS_VERIFICATION_NOT_CONFIGURED', status: 503 }), { code: 'SMS_VERIFICATION_NOT_CONFIGURED', status: 503 })
  assert.deepEqual(verificationFailure({ code: 'SMS_VERIFICATION_RATE_LIMITED', status: 429 }), { code: 'SMS_VERIFICATION_RATE_LIMITED', status: 429 })
  assert.deepEqual(verificationFailure(new Error('provider response body')), { code: 'VERIFICATION_SERVICE_UNAVAILABLE', status: 503 })
})

test('operational restaurant and rider APIs require their roles', async () => {
  const restaurantResponse = await request(app).get('/api/restaurant/orders')
  const riderResponse = await request(app).get('/api/rider/deliveries')
  const riderProfileResponse = await request(app).get('/api/rider/profile')
  assert.equal(restaurantResponse.status, 401)
  assert.equal(riderResponse.status, 401)
  assert.equal(riderProfileResponse.status, 401)
})

test('application status checks require valid account credentials', async () => {
  const response = await request(app).post('/api/application-status').send({ email: 'not-an-email', password: '' })
  assert.equal(response.status, 400)
  assert.equal(response.body.error, 'INVALID_APPLICATION_STATUS_REQUEST')
})
