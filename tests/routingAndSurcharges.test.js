import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchRoadRoutes, routingProviders } from '../server/parcelService.js'
import { defaultDeliveryPricing, demandExtra, isNight, priceDelivery } from '../server/deliveryPricing.js'
import { deliveryPricingSchema } from '../server/deliveryPricingSettings.js'
import { waitingPay } from '../server/financeLedger.js'
import { confidenceFor, suggestionsFor } from '../server/roadReports.js'

const A = { latitude: 5.89, longitude: 5.68 }
const B = { latitude: 5.92, longitude: 5.71 }
const route = (meters) => ({ distance: meters, duration: 600, geometry: { type: 'LineString', coordinates: [[5.68, 5.89], [5.71, 5.92]] } })
const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body })

test('routing providers come from configuration, in order, and skip unconfigured ones', () => {
  assert.deepEqual(routingProviders({}), [])
  assert.deepEqual(routingProviders({ MAPBOX_SERVER_TOKEN: 'x' }), ['mapbox'])
  assert.deepEqual(routingProviders({ MAPBOX_SERVER_TOKEN: 'x', OSRM_URL: 'http://osrm:5000' }), ['mapbox', 'osrm'])
  assert.deepEqual(routingProviders({ ROUTING_PROVIDERS: 'osrm,mapbox', MAPBOX_SERVER_TOKEN: 'x', OSRM_URL: 'http://osrm:5000' }), ['osrm', 'mapbox'])
})

test('when Mapbox is down the self-hosted OSRM answers; the route says which provider measured it', async () => {
  const calls = []
  const fetchImpl = async (url) => { calls.push(url); return url.includes('mapbox') ? reply(503, {}) : reply(200, { code: 'Ok', routes: [route(4200)] }) }
  const routes = await fetchRoadRoutes(A, B, { fetchImpl, env: { MAPBOX_SERVER_TOKEN: 'secret', OSRM_URL: 'http://osrm:5000/' } })
  assert.equal(routes[0].distanceMeters, 4200)
  assert.equal(routes[0].provider, 'osrm-driving')
  assert.match(calls[1], /^http:\/\/osrm:5000\/route\/v1\/driving\/5\.68,5\.89;5\.71,5\.92/)
  assert.doesNotMatch(calls[1], /secret/, 'the Mapbox token is never sent to another provider')
  await assert.rejects(fetchRoadRoutes(A, B, { fetchImpl: async () => reply(200, { code: 'NoRoute', routes: [] }), env: { OSRM_URL: 'http://osrm:5000' } }), (error) => error.code === 'NO_ROAD_ROUTE')
})

const pricing = (patch = {}) => ({ ...structuredClone(defaultDeliveryPricing), published: true, margin: { protect: false, minimumMinor: 0 }, ...patch })
const finance = { commission: { doorstepRiderPercent: 15, ownRiderPercent: 10 }, riderPay: { enabled: true, bands: [{ upToKm: 3, amountMinor: 80_000 }, { upToKm: 6, amountMinor: 120_000 }], perKmAfterMinor: 15_000 }, riderFee: { percent: 0 } }
const road = (km) => ({ meters: km * 1000, source: 'ROAD', warnings: [] })
const NIGHT = new Date('2026-11-10T22:30:00Z') // 23:30 in Lagos
const DAY = new Date('2026-11-10T11:00:00Z')

test('night and difficult-access charges are added (and shown) only when set; the rider gets the night extra', () => {
  const zone = { id: 'creek', name: 'Creek side', latitude: null, longitude: null, radiusMeters: 1000, customerSurchargeMinor: 0, riderBonusMinor: 0, fixedFeeMinor: null, remote: false, difficultAccessMinor: 40_000, active: true }
  const p = pricing({ surcharges: { remoteMinor: 0, weekend: { active: false, minor: 0 }, night: { active: true, fromHour: 21, toHour: 6, minor: 30_000, riderMinor: 20_000 } } })
  const atNight = priceDelivery({ distance: road(4), dropoffZone: zone, pricing: p, finance, now: NIGHT })
  const atDay = priceDelivery({ distance: road(4), dropoffZone: zone, pricing: p, finance, now: DAY })
  assert.equal(atNight.customer.nightMinor, 30_000)
  assert.equal(atDay.customer.nightMinor, 0)
  assert.equal(atNight.customer.difficultAccessMinor, 40_000)
  assert.equal(atNight.rider.payMinor - atDay.rider.payMinor, 20_000)
  assert.equal(isNight(new Date('2026-11-10T04:30:00Z'), 21, 6), true, '05:30 Lagos is still night')
})

test('demand-based pricing is OFF by default and adds nothing however busy it is', () => {
  assert.equal(defaultDeliveryPricing.demand.enabled, false)
  assert.equal(deliveryPricingSchema.parse({ ...structuredClone(defaultDeliveryPricing), demand: undefined }).demand.enabled, false, 'saved settings without it load as OFF')
  const busy = { waiting: 40, freeRiders: 0 }
  const priced = priceDelivery({ distance: road(4), pricing: pricing(), finance, now: DAY, demandSnapshot: busy })
  assert.equal(priced.customer.demandMinor, 0)
  assert.deepEqual(demandExtra(defaultDeliveryPricing.demand, busy, 200_000), { percent: 0, minor: 0 })
})

test('if the owner switches demand pricing on, it stays within the limits and the chosen areas', () => {
  const demand = { enabled: true, triggerRatio: 3, stepPercent: 10, maxPercent: 30, maxExtraMinor: 50_000, riderSharePercent: 50, zoneIds: ['town'] }
  assert.equal(demandExtra(demand, { waiting: 2, freeRiders: 1, zoneId: 'town' }, 200_000).minor, 0, 'below the trigger')
  assert.deepEqual(demandExtra(demand, { waiting: 6, freeRiders: 1, zoneId: 'town' }, 200_000), { percent: 20, minor: 40_000 })
  assert.equal(demandExtra(demand, { waiting: 90, freeRiders: 1, zoneId: 'town' }, 200_000).percent, 30, 'never above the maximum')
  assert.equal(demandExtra(demand, { waiting: 90, freeRiders: 1, zoneId: 'town' }, 900_000).minor, 50_000, 'never above the naira cap')
  assert.equal(demandExtra(demand, { waiting: 90, freeRiders: 1, zoneId: 'village' }, 200_000).minor, 0, 'other areas unaffected')
})

test('rider waiting pay: only past the free minutes, capped, and off unless switched on', () => {
  const settings = { enabled: true, freeMinutes: 10, perMinuteMinor: 2_000, maxMinor: 30_000 }
  const arrived = new Date('2026-11-10T12:00:00Z')
  assert.equal(waitingPay(settings, arrived, new Date('2026-11-10T12:09:00Z')), 0)
  assert.equal(waitingPay(settings, arrived, new Date('2026-11-10T12:16:30Z')), 12_000)
  assert.equal(waitingPay(settings, arrived, new Date('2026-11-10T13:30:00Z')), 30_000)
  assert.equal(waitingPay({ ...settings, enabled: false }, arrived, new Date('2026-11-10T13:30:00Z')), 0)
  assert.equal(waitingPay(defaultDeliveryPricing.waiting, arrived, new Date('2026-11-10T13:30:00Z')), 0, 'off by default')
})

test('road reports: confidence from different riders, fresh only; suggestions flag stale ones', () => {
  const now = new Date('2026-11-10T12:00:00Z')
  const daysAgo = (days) => new Date(now.getTime() - days * 86_400_000)
  const reports = [
    { id: '1', riderId: 'a', kind: 'DISTANCE', area: 'Amukpe junction', distanceKm: 6, status: 'APPROVED', reviewedAt: daysAgo(3), createdAt: daysAgo(3), note: 'Bad road' },
    { id: '2', riderId: 'b', kind: 'DISTANCE', area: 'Amukpe', distanceKm: 7, status: 'APPROVED', reviewedAt: daysAgo(10), createdAt: daysAgo(10), note: 'Detour' },
    { id: '3', riderId: 'a', kind: 'DISTANCE', area: 'Amukpe', distanceKm: 6.5, status: 'APPROVED', reviewedAt: daysAgo(20), createdAt: daysAgo(20), note: 'Same rider again' },
    { id: '4', riderId: 'c', kind: 'DISTANCE', area: 'Amukpe', distanceKm: 20, status: 'APPROVED', reviewedAt: daysAgo(200), createdAt: daysAgo(200), note: 'Old' },
    { id: '5', riderId: 'd', kind: 'DISTANCE', area: 'Amukpe', distanceKm: 1, status: 'REJECTED', createdAt: daysAgo(1), note: 'Wrong' },
  ]
  assert.deepEqual(confidenceFor(reports, now), { riders: 2, level: 'MEDIUM' }, 'two different riders, the old and the rejected ones don’t count')
  const suggestions = suggestionsFor(reports, 'Amukpe', now)
  assert.equal(suggestions.suggestedKm, 6.5, 'middle of the fresh distances')
  assert.equal(suggestions.reports.find((report) => report.id === '4').stale, true)
  assert.equal(suggestions.reports.some((report) => report.id === '5'), false)
})
