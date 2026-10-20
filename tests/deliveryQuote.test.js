import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultDeliveryPricing, STARTER_RIDER_BANDS } from '../server/deliveryPricing.js'
import { deliveryPricingSchema, getDeliveryPricing } from '../server/deliveryPricingSettings.js'
import { orderPricingSnapshot, quoteOrderDelivery, resolveDropoff } from '../server/deliveryQuote.js'
import { defaultFinanceSettings } from '../server/financeService.js'

process.env.MAPBOX_SERVER_TOKEN = 'test-token'
const published = () => ({ ...structuredClone(defaultDeliveryPricing), published: true })
// Approved delivery zones now come from Admin › Locations (verified + coverage approved + switched on). Tests pass them in.
const zone = (id, name, latitude, longitude, extra = {}) => ({ id, locationId: `loc-${id}`, name, latitude, longitude, coverageMethod: 'RADIUS', radiusMeters: 1500, coverageRadiusMeters: 1500, customerSurchargeMinor: 0, riderBonusMinor: 0, minimumOrderMinor: null, closed: false, closedReason: null, active: true, ...extra })
const amukpe = () => zone('sapele-rural-amukpe', 'Sapele Rural / Amukpe', 5.9100, 5.6846)
const finance = { ...structuredClone(defaultFinanceSettings), riderPay: { enabled: true, bands: STARTER_RIDER_BANDS, perKmAfterMinor: 12_000 } }
const restaurant = { latitude: '5.8916', longitude: '5.6846', application: { deliveryPreference: 'DOORSTEP_RIDERS' } }
const mapbox = (distances) => async () => ({ ok: true, status: 200, json: async () => ({ code: 'Ok', routes: distances.map((distance) => ({ distance, duration: distance / 8, geometry: { type: 'LineString', coordinates: [] } })) }) })

test('starter settings are valid and unpublished; invalid stored settings fall back safely', async () => {
  assert.equal(deliveryPricingSchema.safeParse(structuredClone(defaultDeliveryPricing)).success, true)
  const empty = await getDeliveryPricing({ platformSetting: { findUnique: async () => null } })
  assert.equal(empty.published, false)
  const broken = await getDeliveryPricing({ platformSetting: { findUnique: async () => ({ value: { published: true } }) } })
  assert.equal(broken.published, false)
  assert.equal(broken.invalidStoredSettings, true)
})

test('schema rejects agreed prices that carry no amounts', () => {
  const pricing = published()
  pricing.routeRules = [{ id: 'r1', fromZoneId: 'sapele-rural-amukpe', toZoneId: 'ogorode', bothWays: true, customerFeeMinor: null, riderPayMinor: null, agreedWith: '', note: '', active: true }]
  assert.equal(deliveryPricingSchema.safeParse(pricing).success, false)
  pricing.routeRules[0].customerFeeMinor = 100_000
  assert.equal(deliveryPricingSchema.safeParse(pricing).success, true)
})

test('unpublished pricing leaves checkout on the old flat fee', async () => {
  const result = await quoteOrderDelivery({ db: null, restaurant, destination: { point: { latitude: 5.91, longitude: 5.6846 } }, subtotalMinor: 800_000, pricing: structuredClone(defaultDeliveryPricing), finance, zones: [] })
  assert.equal(result, null)
})

test('an exact pin is priced on the shortest road route and fixes the rider pay on the order', async () => {
  const result = await quoteOrderDelivery({ db: null, restaurant, destination: { point: { latitude: 5.91, longitude: 5.6846 } }, subtotalMinor: 800_000, pricing: published(), finance, zones: [amukpe()], fetchImpl: mapbox([3100, 2600]) })
  assert.equal(result.distance.source, 'ROAD')
  assert.equal(result.km, 2.6)
  assert.equal(result.dropoffZone?.name, 'Sapele Rural / Amukpe')
  assert.equal(result.rider.payMinor, 70_000)
  const snapshot = orderPricingSnapshot(result)
  assert.equal(snapshot.plannedRiderPayMinor, 70_000)
  assert.equal(snapshot.deliveryDistanceMeters, 2600)
  assert.equal(snapshot.deliveryQuote.customer.deliveryFeeMinor, result.customer.deliveryFeeMinor)
})

test('choosing an area without a pin prices from the area centre', async () => {
  const pricing = published()
  const dropoff = resolveDropoff({ point: null, addressLine: 'Amukpe, Sapele' }, [amukpe()])
  assert.equal(dropoff.source, 'AREA_CENTRE')
  assert.equal(resolveDropoff({ point: null, addressLine: 'Amukpe, Sapele' }, []).source, 'UNKNOWN', 'an unapproved area is never used')
  const result = await quoteOrderDelivery({ db: null, restaurant, destination: { point: null, addressLine: 'Amukpe, Sapele' }, subtotalMinor: 500_000, pricing, finance, zones: [amukpe()], fetchImpl: mapbox([2500]) })
  assert.equal(result.dropoffSource, 'AREA_CENTRE')
  assert.ok(result.warnings.includes('AREA_CENTRE'))
})

test('a typed street from the Sapele directory is priced from its approved district zone', async () => {
  const district = zone('ayomanor-road-district', 'Ayomanor Road district', 5.8950, 5.6800)
  const dropoff = resolveDropoff({ point: null, addressLine: '14 Boyo Road, Sapele' }, [district])
  assert.equal(dropoff.source, 'AREA_CENTRE')
  assert.equal(dropoff.zone.id, 'ayomanor-road-district')
  assert.equal(resolveDropoff({ point: null, addressLine: '14 Boyo Road, Sapele' }, []).source, 'UNKNOWN', 'an unapproved district is never guessed')
})

test('paused areas, area minimums and the approved-zone requirement are enforced on the server', async () => {
  const pin = { point: { latitude: 5.91, longitude: 5.6846 } }
  await assert.rejects(quoteOrderDelivery({ db: null, restaurant, destination: pin, subtotalMinor: 800_000, pricing: published(), finance, zones: [amukpe({})].map((z) => ({ ...z, closed: true, closedReason: 'flooding' })), fetchImpl: mapbox([2600]) }), (error) => error.code === 'AREA_PAUSED' && /flooding/.test(error.message))
  await assert.rejects(quoteOrderDelivery({ db: null, restaurant, destination: pin, subtotalMinor: 300_000, pricing: published(), finance, zones: [{ ...amukpe(), minimumOrderMinor: 500_000 }], fetchImpl: mapbox([2600]) }), (error) => error.code === 'BELOW_AREA_MINIMUM')
  const strict = { ...published(), coverage: { requireApprovedZone: true } }
  await assert.rejects(quoteOrderDelivery({ db: null, restaurant, destination: { point: { latitude: 5.80, longitude: 5.60 } }, subtotalMinor: 800_000, pricing: strict, finance, zones: [amukpe()], fetchImpl: mapbox([9000]) }), (error) => error.code === 'OUTSIDE_COVERAGE' && error.status === 422)
  const inside = await quoteOrderDelivery({ db: null, restaurant, destination: pin, subtotalMinor: 800_000, pricing: strict, finance, zones: [amukpe()], fetchImpl: mapbox([2600]) })
  assert.equal(inside.dropoffZone?.name, 'Sapele Rural / Amukpe')
})

test('missing pins use the assumed distance and leave the rider pay for review', async () => {
  const result = await quoteOrderDelivery({ db: null, restaurant: { ...restaurant, latitude: null, longitude: null }, destination: { point: { latitude: 5.91, longitude: 5.68 } }, subtotalMinor: 500_000, pricing: published(), finance, zones: [] })
  assert.equal(result.distance.source, 'ASSUMED')
  assert.ok(result.warnings.includes('PICKUP_NOT_PINNED'))
  assert.equal(orderPricingSnapshot(result).plannedRiderPayMinor, null)
})

test('trips beyond the maximum distance are refused with a clear message', async () => {
  await assert.rejects(
    quoteOrderDelivery({ db: null, restaurant, destination: { point: { latitude: 6.05, longitude: 5.6846 } }, subtotalMinor: 500_000, pricing: published(), finance, zones: [], fetchImpl: mapbox([21_000]) }),
    (error) => error.code === 'DELIVERY_TOO_FAR' && /15 km/.test(error.message),
  )
})

test('a routing outage still prices the order from an estimate instead of failing checkout', async () => {
  const down = async () => { throw new Error('offline') }
  const result = await quoteOrderDelivery({ db: null, restaurant, destination: { point: { latitude: 5.905, longitude: 5.6846 } }, subtotalMinor: 500_000, pricing: published(), finance, zones: [], fetchImpl: down })
  assert.equal(result.distance.source, 'ESTIMATE')
  assert.ok(result.customer.deliveryFeeMinor > 0)
})
