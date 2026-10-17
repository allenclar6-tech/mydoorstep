import assert from 'node:assert/strict'
import { test } from 'node:test'
import express from 'express'
import request from 'supertest'
import { createNavigationRouter } from '../server/navigation.js'
import { createMapboxNavigationClient } from '../src/navigation/mapboxApi.js'
import { decodePolyline, distanceBetween, emptyPreferences, formatDistance, formatDuration, gpsErrorMessage, measurePath, navigationProgress, parseSharedPlan, prepareRoute, projectOnRoute, sharePlanUrl, validPoint } from '../src/navigation/navigation.js'

const start = { latitude: 38.5, longitude: -120.2 }
const middle = { latitude: 40.7, longitude: -120.95 }
const end = { latitude: 43.252, longitude: -126.453 }
const sessionToken = 'f91015f9-c5ae-4d04-a677-17549c9d1f11'
const encodedPolyline = '_p~iF~ps|U_ulLnnqC_mqNvxq`@'
const providerRoute = {
  description: 'Main Road',
  distanceMeters: 1200,
  duration: '240s',
  polyline: { encodedPolyline },
  warnings: ['Check road signs.'],
  legs: [{
    distanceMeters: 1200,
    duration: '240s',
    endLocation: { latLng: end },
    steps: [{
      distanceMeters: 1200,
      staticDuration: '220s',
      endLocation: { latLng: end },
      navigationInstruction: { instructions: 'Turn right onto Main Road.', maneuver: 'TURN_RIGHT' },
    }],
  }],
}

test('Mapbox search and retrieval use the existing public token and a shared search session', async () => {
  const calls = []
  const client = createMapboxNavigationClient('pk.test-public-token', async (url) => {
    calls.push(new URL(url))
    return Response.json(calls.length === 1
      ? { suggestions: [{ mapbox_id: 'mapbox.place:test', name: 'Sapele', place_formatted: 'Delta, Nigeria' }] }
      : { features: [{ geometry: { coordinates: [5.68, 5.89] }, properties: { name: 'Sapele', place_formatted: 'Delta, Nigeria' } }] })
  })
  const search = await client(`/search?query=Sapele&sessionToken=${sessionToken}`)
  const place = await client(`/places/${encodeURIComponent(search.suggestions[0].placeId)}?sessionToken=${sessionToken}`)
  assert.equal(search.suggestions[0].label, 'Sapele, Delta, Nigeria')
  assert.equal(place.place.latitude, 5.89)
  assert.equal(place.place.longitude, 5.68)
  assert.equal(calls[0].hostname, 'api.mapbox.com')
  assert.equal(calls[0].searchParams.get('session_token'), sessionToken)
  assert.equal(calls[1].searchParams.get('session_token'), sessionToken)
})

test('Mapbox routes preserve stop order, normalize instructions and apply driving exclusions', async () => {
  let url
  const client = createMapboxNavigationClient('pk.test-public-token', async (input) => {
    url = new URL(input)
    return Response.json({ code: 'Ok', routes: [{
      distance: 1200, duration: 240, geometry: encodedPolyline,
      legs: [{ summary: 'Main Road', distance: 1200, duration: 240, steps: [
        { distance: 1200, duration: 240, geometry: encodedPolyline, maneuver: { instruction: 'Turn onto Main Road.', type: 'turn' } },
      ] }],
    }] })
  })
  const response = await client('/routes', { body: {
    origin: start, destination: end, intermediates: [middle], travelMode: 'DRIVE',
    preferences: { avoidTolls: true, avoidHighways: true, avoidFerries: true },
  } })
  assert.ok(url.pathname.includes(`${start.longitude},${start.latitude};${middle.longitude},${middle.latitude};${end.longitude},${end.latitude}`))
  assert.equal(url.searchParams.get('alternatives'), 'false')
  assert.equal(url.searchParams.get('exclude'), 'toll,motorway,ferry')
  assert.equal(response.routes[0].durationSeconds, 240)
  assert.deepEqual(response.routes[0].legs[0].steps[0].endLocation, end)
  assert.equal(prepareRoute(response.routes[0]).steps[0].instruction, 'Turn onto Main Road.')
})

test('Mapbox walking and cycling profiles do not use driving-only preferences', async () => {
  for (const [mode, profile] of [['WALK', 'walking'], ['BICYCLE', 'cycling']]) {
    let url
    const client = createMapboxNavigationClient('pk.test-public-token', async (input) => {
      url = new URL(input)
      return Response.json({ code: 'NoRoute', routes: [] })
    })
    await assert.rejects(client('/routes', { body: { origin: start, destination: end, travelMode: mode, preferences: { avoidTolls: true } } }), /No route/)
    assert.ok(url.pathname.includes(`/mapbox/${profile}/`))
    assert.equal(url.searchParams.has('exclude'), false)
    assert.equal(url.searchParams.get('alternatives'), 'true')
  }
})

test('Mapbox usage limits and invalid tokens produce explicit errors without fabricated routes', async () => {
  await assert.rejects(createMapboxNavigationClient('')('/routes', { body: { origin: start, destination: end } }), /public Mapbox token/)
  await assert.rejects(createMapboxNavigationClient('sk.secret')('/routes', { body: { origin: start, destination: end } }), /public Mapbox token/)
  await assert.rejects(createMapboxNavigationClient('pk.test', async () => new Response('', { status: 429 }))('/routes', { body: { origin: start, destination: end } }), /usage limit/)
  await assert.rejects(createMapboxNavigationClient('pk.test', async () => new Response('', { status: 403 }))('/routes', { body: { origin: start, destination: end } }), /rejected/)
})

function api(fetchImpl = async () => Response.json({ routes: [providerRoute] }), key = 'server-only-test-key') {
  const app = express()
  app.use(express.json())
  app.use('/api/navigation', createNavigationRouter({ fetchImpl, getKey: () => key }))
  return request(app)
}

test('navigation rejects invalid origins, coordinates, modes, stops and preferences before provider calls', async () => {
  let calls = 0
  const client = api(async () => { calls += 1; throw new Error('Should not call provider') })
  const valid = { origin: start, destination: end }
  const invalid = [
    {}, { ...valid, origin: { latitude: 91, longitude: 0 } },
    { ...valid, destination: { latitude: 0, longitude: 181 } },
    { ...valid, origin: { latitude: '5', longitude: 5 } },
    { ...valid, travelMode: 'FLY' },
    { ...valid, intermediates: Array(9).fill(middle) },
    { ...valid, preferences: { arbitrary: true } },
    { ...valid, travelMode: 'WALK', preferences: { avoidTolls: true } },
    { ...valid, apiKey: 'client-controlled' },
  ]
  for (const body of invalid) {
    const response = await client.post('/api/navigation/routes').send(body)
    assert.equal(response.status, 400)
    assert.equal(response.body.error, 'INVALID_NAVIGATION_ROUTE')
  }
  assert.equal(calls, 0)
})

test('Google Routes request uses server key, constrained field mask and real traffic-aware directions', async () => {
  let captured
  const response = await api(async (url, options) => {
    captured = { url, ...options, body: JSON.parse(options.body) }
    return Response.json({ routes: [providerRoute, { ...providerRoute, description: 'Other Road' }] })
  }).post('/api/navigation/routes').send({ origin: start, destination: end, preferences: { avoidTolls: true } })
  assert.equal(response.status, 200)
  assert.equal(captured.url, 'https://routes.googleapis.com/directions/v2:computeRoutes')
  assert.equal(captured.headers['X-Goog-Api-Key'], 'server-only-test-key')
  assert.match(captured.headers['X-Goog-FieldMask'], /routes\.legs\.steps\.navigationInstruction/)
  assert.equal(captured.body.routingPreference, 'TRAFFIC_AWARE')
  assert.equal(captured.body.computeAlternativeRoutes, true)
  assert.equal(captured.body.routeModifiers.avoidTolls, true)
  assert.deepEqual(captured.body.origin.location.latLng, start)
  assert.ok(captured.signal instanceof AbortSignal)
  assert.equal(response.body.routes.length, 2)
  assert.equal(response.body.routes[0].durationSeconds, 240)
  assert.equal(response.body.routes[0].legs[0].steps[0].instruction, 'Turn right onto Main Road.')
  assert.deepEqual(response.body.routes[0].legs[0].endLocation, end)
  assert.match(response.headers['cache-control'], /no-store/)
  assert.ok(!JSON.stringify(response.body).includes('server-only-test-key'))
})

test('multi-stop request preserves order and disables unsupported alternative routes', async () => {
  let body
  const response = await api(async (_url, options) => {
    body = JSON.parse(options.body)
    return Response.json({ routes: [providerRoute] })
  }).post('/api/navigation/routes').send({ origin: start, destination: end, intermediates: [middle, start] })
  assert.equal(response.status, 200)
  assert.equal(body.computeAlternativeRoutes, false)
  assert.deepEqual(body.intermediates.map((point) => point.location.latLng), [middle, start])
})

for (const travelMode of ['WALK', 'BICYCLE']) {
  test(`${travelMode} routes omit driving-only traffic and modifiers`, async () => {
    let body
    const response = await api(async (_url, options) => {
      body = JSON.parse(options.body)
      return Response.json({ routes: [providerRoute] })
    }).post('/api/navigation/routes').send({ origin: start, destination: end, travelMode })
    assert.equal(response.status, 200)
    assert.equal(body.travelMode, travelMode)
    assert.equal(body.routingPreference, undefined)
    assert.equal(body.routeModifiers, undefined)
  })
}

test('unconfigured navigation returns an explicit unavailable state without calling Google', async () => {
  let calls = 0
  const response = await api(async () => { calls += 1 }, '').post('/api/navigation/routes').send({ origin: start, destination: end })
  assert.equal(response.status, 503)
  assert.equal(response.body.error, 'NAVIGATION_NOT_CONFIGURED')
  assert.equal(calls, 0)
})

test('provider denial, quotas and network failures return safe errors rather than fabricated routes', async () => {
  for (const [fetchImpl, code] of [
    [async () => new Response('private provider diagnostic', { status: 403 }), 'NAVIGATION_PROVIDER_UNAVAILABLE'],
    [async () => new Response('quota', { status: 429 }), 'NAVIGATION_PROVIDER_RATE_LIMITED'],
    [async () => { throw new TypeError('private network diagnostic') }, 'NAVIGATION_UNAVAILABLE'],
    [async () => new Response('{broken', { status: 200 }), 'NAVIGATION_UNAVAILABLE'],
  ]) {
    const response = await api(fetchImpl).post('/api/navigation/routes').send({ origin: start, destination: end })
    assert.equal(response.status, 502)
    assert.equal(response.body.error, code)
    assert.ok(!JSON.stringify(response.body).includes('private'))
    assert.equal(response.body.routes, undefined)
  }
})

test('unavailable and malformed provider routes never become successful fallback results', async () => {
  for (const [body, code, status] of [
    [{ routes: [] }, 'NO_ROUTE', 404],
    [{ routes: [{ ...providerRoute, duration: 'invalid' }] }, 'INVALID_ROUTE_RESPONSE', 502],
    [{ routes: [{ ...providerRoute, polyline: {} }] }, 'INVALID_ROUTE_RESPONSE', 502],
  ]) {
    const response = await api(async () => Response.json(body)).post('/api/navigation/routes').send({ origin: start, destination: end })
    assert.equal(response.status, status)
    assert.equal(response.body.error, code)
  }
})

test('Places autocomplete uses a session token and location bias, supporting business and landmark predictions', async () => {
  let captured
  const response = await api(async (url, options) => {
    captured = { url, ...options, body: JSON.parse(options.body) }
    return Response.json({ suggestions: [
      { placePrediction: { placeId: 'NotLimitedToChIPrefix', text: { text: 'Sapele Central Hospital' } } },
      { placePrediction: { placeId: 'BusinessPlace', text: { text: 'Local shop' } } },
      { queryPrediction: { text: { text: 'Ignore query-only result' } } },
    ] })
  }).get('/api/navigation/search').query({ query: 'hospital', sessionToken })
  assert.equal(response.status, 200)
  assert.equal(captured.body.sessionToken, sessionToken)
  assert.ok(captured.body.locationBias.circle)
  assert.equal(captured.body.includedPrimaryTypes, undefined)
  assert.equal(response.body.suggestions.length, 2)
})

test('Places details accepts opaque place IDs instead of requiring a ChI prefix', async () => {
  let url
  const response = await api(async (input) => {
    url = input
    return Response.json({ id: 'OpaquePlace_123', location: middle, displayName: { text: 'My business' } })
  }).get('/api/navigation/places/OpaquePlace_123').query({ sessionToken })
  assert.equal(response.status, 200)
  assert.equal(response.body.place.label, 'My business')
  assert.deepEqual({ latitude: response.body.place.latitude, longitude: response.body.place.longitude }, middle)
  assert.ok(url.includes(sessionToken))
})

test('invalid search sessions and place IDs cannot cause arbitrary provider requests', async () => {
  let calls = 0
  const client = api(async () => { calls += 1 })
  assert.equal((await client.get('/api/navigation/search').query({ query: 'ab', sessionToken })).status, 400)
  assert.equal((await client.get('/api/navigation/search').query({ query: 'Sapele', sessionToken: 'invalid' })).status, 400)
  assert.equal((await client.get('/api/navigation/places/invalid%3Fplace').query({ sessionToken })).status, 400)
  assert.equal(calls, 0)
})

test('Places without coordinates produce a clear unavailable response', async () => {
  const response = await api(async () => Response.json({ displayName: { text: 'No location' } }))
    .get('/api/navigation/places/SomePlace').query({ sessionToken })
  assert.equal(response.status, 404)
  assert.equal(response.body.error, 'PLACE_LOCATION_UNAVAILABLE')
})

test('navigation endpoints enforce a shared request limit', async () => {
  const client = api()
  for (let index = 0; index < 40; index += 1) await client.get('/api/navigation/search')
  const response = await client.get('/api/navigation/search')
  assert.equal(response.status, 429)
  assert.equal(response.body.error, 'NAVIGATION_RATE_LIMITED')
})

test('polyline decoder returns exact real provider coordinate shape and rejects corrupt geometry', () => {
  assert.deepEqual(decodePolyline(encodedPolyline), [start, middle, end])
  assert.throws(() => decodePolyline('_p~iF~ps|U_'))
  assert.throws(() => decodePolyline('abc'))
  assert.throws(() => decodePolyline(''))
  assert.throws(() => decodePolyline('\u0000'))
})

test('distance and route projection measure metres, not degrees or straight destination distance', () => {
  const path = measurePath([{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.01 }, { latitude: 0.01, longitude: 0.01 }])
  assert.ok(Math.abs(path.at(-1).along - 2223.9) < 2)
  const position = { latitude: 0.001, longitude: 0.005 }
  const projected = projectOnRoute(position, path)
  assert.ok(Math.abs(projected.distance - 111.2) < 1)
  assert.ok(Math.abs(projected.along - 556) < 1)
  assert.ok(distanceBetween(position, path.at(-1)) > projected.distance)
})

test('navigation advances instructions and monotonically tracks remaining route distance', () => {
  const path = measurePath([{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.01 }, { latitude: 0.01, longitude: 0.01 }])
  const route = {
    path, geometryDistance: path.at(-1).along, distanceMeters: 2400, durationSeconds: 300,
    steps: [{ endAlong: path[1].along, instruction: 'Turn left' }, { endAlong: path[2].along, instruction: 'Arrive' }],
  }
  const progress = navigationProgress(route, { latitude: 0, longitude: 0.005 })
  assert.equal(progress.step.instruction, 'Turn left')
  assert.ok(progress.remainingMeters > 1790 && progress.remainingMeters < 1810)
  assert.ok(progress.nextTurnMeters > 550 && progress.nextTurnMeters < 560)
  const next = navigationProgress(route, { latitude: 0.005, longitude: 0.01 }, progress.along)
  assert.equal(next.step.instruction, 'Arrive')
  assert.ok(next.remainingMeters < progress.remainingMeters)
  assert.ok(next.remainingSeconds < progress.remainingSeconds)
  const backwards = navigationProgress(route, { latitude: 0, longitude: 0.001 }, next.along)
  assert.ok(backwards.along >= next.along)
})

test('prepared routes retain leg-aware steps and provider road names as plain text', () => {
  const route = prepareRoute({
    encodedPolyline, distanceMeters: 1200, durationSeconds: 240,
    legs: [{ steps: [{ endLocation: middle, instruction: 'Turn onto Main Road.' }, { endLocation: end, instruction: 'Arrive' }] }],
  })
  assert.equal(route.steps[0].instruction, 'Turn onto Main Road.')
  assert.equal(route.steps[0].legIndex, 0)
  assert.ok(route.steps[1].endAlong > route.steps[0].endAlong)
})

test('shared route preserves destination order and travel mode without including authentication', () => {
  const url = sharePlanUrl({ ...start, label: 'Home' }, [{ ...middle, label: 'Shop' }, { ...end, label: 'Destination' }], 'WALK', 'https://mydoorstep.com.co')
  const parsed = new URL(url)
  assert.equal(parsed.pathname, '/navigate')
  const plan = parseSharedPlan(parsed.search)
  assert.equal(plan.mode, 'WALK')
  assert.equal(plan.stops.length, 2)
  assert.equal(plan.stops[0].label, 'Shop')
  assert.equal(plan.origin.latitude, start.latitude)
  assert.deepEqual(plan.preferences, emptyPreferences)
  assert.ok(!url.includes('token'))
  assert.equal(parseSharedPlan(''), null)
})

test('malformed and oversized shared plans cannot enter the planner', () => {
  for (const plan of [
    'broken',
    JSON.stringify({ origin: start, stops: [], mode: 'DRIVE' }),
    JSON.stringify({ origin: { latitude: 999, longitude: 0 }, stops: [end], mode: 'DRIVE' }),
    JSON.stringify({ origin: start, stops: Array(10).fill(end), mode: 'DRIVE' }),
    JSON.stringify({ origin: start, stops: [end], mode: 'FLY' }),
    JSON.stringify({ origin: start, stops: [end], mode: 'DRIVE', preferences: { avoidTolls: 'yes' } }),
    'x'.repeat(6001),
  ]) assert.throws(() => parseSharedPlan(`?plan=${encodeURIComponent(plan)}`))
})

test('location validation, formatting and GPS error states cover supported units and denied permission', () => {
  assert.equal(validPoint(start), true)
  assert.equal(validPoint({ latitude: NaN, longitude: 5 }), false)
  assert.equal(validPoint({ latitude: 5 }), false)
  assert.equal(formatDistance(150), '150 m')
  assert.equal(formatDistance(1250), '1.3 km')
  assert.equal(formatDuration(120), '2 min')
  assert.equal(formatDuration(3700), '1 hr 2 min')
  assert.match(gpsErrorMessage({ code: 1 }), /denied/)
  assert.match(gpsErrorMessage({ code: 2 }), /cannot find/)
  assert.match(gpsErrorMessage({ code: 3 }), /timed out/)
  assert.deepEqual(emptyPreferences, { avoidTolls: false, avoidHighways: false, avoidFerries: false })
})
