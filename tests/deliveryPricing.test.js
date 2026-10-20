import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chooseDistance, defaultDeliveryPricing, distanceFee, distanceTable, findRouteRule, measureDelivery, priceDelivery, roundUpTo, serviceFeeFor, starterZones, zoneForPoint, zoneForText } from '../server/deliveryPricing.js'
import { defaultFinanceSettings } from '../server/financeService.js'

const pricing = (overrides = {}) => ({ ...structuredClone(defaultDeliveryPricing), published: true, ...overrides })
const finance = (bands = [{ upToKm: 2, amountMinor: 50_000 }, { upToKm: 4, amountMinor: 70_000 }, { upToKm: 6, amountMinor: 90_000 }], perKmAfterMinor = 12_000) => ({ ...structuredClone(defaultFinanceSettings), riderPay: { enabled: true, bands, perKmAfterMinor } })
const dist = (meters, extra = {}) => ({ meters, source: 'ROAD', warnings: [], ...extra })

test('customer fee: base covers the first km, then a per-km charge, clamped to min and max', () => {
  const fee = defaultDeliveryPricing.customerFee
  assert.equal(distanceFee(1, fee).feeMinor, 70_000)
  assert.equal(distanceFee(4, fee).feeMinor, 70_000 + 2 * 15_000)
  assert.equal(distanceFee(40, fee).feeMinor, fee.maximumMinor)
})

test('a typical 3.4 km DOORSTEP delivery itemises fee, rider pay and DOORSTEP revenue', () => {
  const priced = priceDelivery({ distance: dist(3400), subtotalMinor: 800_000, pricing: pricing(), finance: finance() })
  assert.equal(priced.km, 3.4)
  assert.equal(priced.customer.deliveryFeeMinor, roundUpTo(70_000 + Math.round(1.4 * 15_000), 5_000)) // ₦950
  assert.equal(priced.rider.payMinor, 70_000)
  assert.equal(priced.serviceFeeMinor, 24_000)
  assert.equal(priced.commission.minor, 120_000) // 15% because DOORSTEP provides the rider
  assert.equal(priced.deliveryMarginMinor, priced.customer.deliveryFeeMinor - 70_000)
  assert.equal(priced.doorstepRevenueMinor, 120_000 + 24_000 + priced.deliveryMarginMinor)
  assert.equal(priced.customerTotalMinor, 800_000 + priced.customer.deliveryFeeMinor + 24_000)
})

test('margin protection raises the fee so a delivery never costs DOORSTEP more than it charges', () => {
  // Rider earns ₦1,000 for this distance but the formula would only charge ₦700.
  const priced = priceDelivery({ distance: dist(1500), pricing: pricing(), finance: finance([{ upToKm: 2, amountMinor: 100_000 }]) })
  assert.equal(priced.customer.marginTopUpMinor, 100_000 + 10_000 - 70_000)
  assert.equal(priced.customer.deliveryFeeMinor, 110_000)
  assert.equal(priced.deliveryMarginMinor, 10_000)
  const unprotected = priceDelivery({ distance: dist(1500), pricing: pricing({ margin: { protect: false, minimumMinor: 0 } }), finance: finance([{ upToKm: 2, amountMinor: 100_000 }]) })
  assert.equal(unprotected.deliveryMarginMinor, -30_000)
  assert.ok(unprotected.warnings.includes('NEGATIVE_DELIVERY_MARGIN'))
})

test('business-owned riders: the business keeps the delivery fee, DOORSTEP takes 10% and pays no rider', () => {
  const priced = priceDelivery({ distance: dist(3000), subtotalMinor: 1_000_000, fulfilment: 'BUSINESS_RIDER', pricing: pricing(), finance: finance() })
  assert.equal(priced.rider.payMinor, null)
  assert.equal(priced.rider.paidBy, 'BUSINESS')
  assert.equal(priced.commission.percent, 10)
  assert.equal(priced.doorstepRevenueMinor, 100_000 + priced.serviceFeeMinor)
})

test('area surcharges, rider bonuses and the rain/busy boost are added and itemised', () => {
  const zones = starterZones(['Amukpe', 'Okpe Road']).map((zone, index) => ({ ...zone, latitude: 5.9 + index / 100, longitude: 5.68, customerSurchargeMinor: index ? 10_000 : 0, riderBonusMinor: index ? 5_000 : 0 }))
  const p = pricing({ zones, boost: { active: true, label: 'Rain', customerExtraMinor: 20_000, riderExtraMinor: 15_000 } })
  const priced = priceDelivery({ distance: dist(2000), pickupZone: zones[0], dropoffZone: zones[1], pricing: p, finance: finance() })
  assert.equal(priced.customer.zoneSurchargeMinor, 10_000)
  assert.equal(priced.customer.boostMinor, 20_000)
  assert.equal(priced.rider.payMinor, 50_000 + 5_000 + 15_000)
})

test('an agreed route price overrides the formula for both directions when bothWays is set', () => {
  const zones = starterZones(['Amukpe', 'Jesse Road'])
  const rule = { id: 'r1', fromZoneId: 'amukpe', toZoneId: 'jesse-road', bothWays: true, customerFeeMinor: 200_000, riderPayMinor: 150_000, agreedWith: 'All riders', note: '', active: true }
  assert.equal(findRouteRule([rule], 'jesse-road', 'amukpe'), rule)
  assert.equal(findRouteRule([{ ...rule, bothWays: false }], 'jesse-road', 'amukpe'), null)
  const priced = priceDelivery({ distance: dist(9000), pickupZone: zones[1], dropoffZone: zones[0], pricing: pricing({ zones, routeRules: [rule] }), finance: finance() })
  assert.equal(priced.customer.deliveryFeeMinor, 200_000)
  assert.equal(priced.rider.payMinor, 150_000)
  assert.equal(priced.deliveryMarginMinor, 50_000)
  assert.equal(priced.rule.agreedWith, 'All riders')
})

test('distance guards: no route, impossible route and huge detours never produce a wild price', () => {
  const settings = defaultDeliveryPricing.distance
  assert.deepEqual(chooseDistance({ straightMeters: 2000, roadMeters: [2600, 2400] }, settings).meters, 2400)
  const missing = chooseDistance({ straightMeters: 2000, roadMeters: [], routingError: 'ROUTING_PROVIDER_UNAVAILABLE' }, settings)
  assert.equal(missing.source, 'ESTIMATE'); assert.equal(missing.meters, 2700)
  const impossible = chooseDistance({ straightMeters: 2000, roadMeters: [900] }, settings)
  assert.equal(impossible.source, 'ESTIMATE'); assert.ok(impossible.warnings.includes('ROUTE_SHORTER_THAN_STRAIGHT_LINE'))
  const detour = chooseDistance({ straightMeters: 1000, roadMeters: [9000] }, settings)
  assert.equal(detour.source, 'ROAD_CAPPED'); assert.equal(detour.meters, 2800)
})

test('measureDelivery uses the shortest road route and falls back to an estimate when routing throws', async () => {
  const a = { latitude: 5.8916, longitude: 5.6846 }
  const b = { latitude: 5.9100, longitude: 5.6846 }
  const ok = await measureDelivery(a, b, defaultDeliveryPricing.distance, async () => [{ distanceMeters: 3100 }, { distanceMeters: 2600 }])
  assert.equal(ok.meters, 2600)
  const failed = await measureDelivery(a, b, defaultDeliveryPricing.distance, async () => { throw Object.assign(new Error('down'), { code: 'ROUTING_PROVIDER_UNAVAILABLE' }) })
  assert.equal(failed.source, 'ESTIMATE')
})

test('areas: a pin is matched to the nearest placed area, typed addresses match the longest area name', () => {
  const zones = [
    { id: 'a', name: 'Sapele Township', latitude: 5.89, longitude: 5.68, radiusMeters: 800, customerSurchargeMinor: 0, riderBonusMinor: 0, active: true },
    { id: 'b', name: 'Warri-Sapele Road', latitude: 5.90, longitude: 5.70, radiusMeters: 800, customerSurchargeMinor: 0, riderBonusMinor: 0, active: true },
    { id: 'c', name: 'Unplaced', latitude: null, longitude: null, radiusMeters: 800, customerSurchargeMinor: 0, riderBonusMinor: 0, active: true },
  ]
  assert.equal(zoneForPoint({ latitude: 5.8905, longitude: 5.6805 }, zones).id, 'a')
  assert.equal(zoneForPoint({ latitude: 5.95, longitude: 5.75 }, zones), null)
  assert.equal(zoneForText('12 Warri-Sapele Road, near the bank', zones).id, 'b')
})

test('service fee and the distance table', () => {
  assert.equal(serviceFeeFor(1_000_000, { percent: 3, minimumMinor: 5_000, maximumMinor: 20_000 }), 20_000)
  assert.equal(serviceFeeFor(10_000, { percent: 3, minimumMinor: 5_000, maximumMinor: 20_000 }), 5_000)
  const rows = distanceTable({ pricing: pricing(), finance: finance(), maxKm: 8 })
  assert.equal(rows.length, 8)
  assert.ok(rows.every((row) => row.deliveryMarginMinor >= defaultDeliveryPricing.margin.minimumMinor), 'margin protection keeps every distance positive')
})

test('without published rider rates the margin is unknown and flagged, never invented', () => {
  const priced = priceDelivery({ distance: dist(3000), pricing: pricing(), finance: structuredClone(defaultFinanceSettings) })
  assert.equal(priced.rider.payMinor, null)
  assert.equal(priced.doorstepRevenueMinor, null)
  assert.ok(priced.warnings.includes('RIDER_RATES_NOT_PUBLISHED'))
})
