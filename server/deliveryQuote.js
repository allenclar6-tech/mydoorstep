// Database + routing side of delivery pricing: finds the pickup and drop-off points, measures the road distance
// (with a short cache so checkout's preview and the real order use the same route), and prices it.
import { isPoint, measureDelivery, priceDelivery, toPoint, zoneForPoint, zoneForText } from './deliveryPricing.js'
import { getDeliveryPricing } from './deliveryPricingSettings.js'
import { getFinanceSettings } from './financeSettings.js'
import { plannedFulfilment, withBusinessCommission } from './financeService.js'
import { areaForAddress } from './sapeleDirectory.js'
import { deliveryZones } from './locations.js'
import { fetchRoadRoutes } from './parcelService.js'

export class DeliveryQuoteError extends Error {
  constructor(code, message, status = 422) { super(message); this.code = code; this.status = status }
}

const ROUTE_CACHE_MS = 15 * 60_000
const routeCache = new Map()
const key = (a, b) => `${a.latitude.toFixed(4)},${a.longitude.toFixed(4)}>${b.latitude.toFixed(4)},${b.longitude.toFixed(4)}`

/** Mapbox road routes (shortest of up to three), cached for 15 minutes by ~10 m grid. */
export function cachedRoutes(fetchImpl) {
  return async (pickup, dropoff) => {
    const cacheKey = key(pickup, dropoff)
    const hit = routeCache.get(cacheKey)
    if (hit && hit.expires > Date.now()) return hit.routes
    const routes = await fetchRoadRoutes(pickup, dropoff, { alternatives: true, ...(fetchImpl ? { fetchImpl } : {}) })
    const slim = routes.map((route) => ({ distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds }))
    routeCache.set(cacheKey, { routes: slim, expires: Date.now() + ROUTE_CACHE_MS })
    if (routeCache.size > 500) routeCache.delete(routeCache.keys().next().value)
    return slim
  }
}

/** Where the customer is: exact pin → saved address pin → named Sapele area's centre → unknown. */
export function resolveDropoff({ point, addressLine }, zones) {
  if (isPoint(point)) return { point: toPoint(point), zone: zoneForPoint(point, zones), source: 'PIN' }
  // A typed area name, or a street/quarter/postcode from the Sapele directory that belongs to a placed area.
  const directoryArea = areaForAddress(addressLine)
  const named = zoneForText(addressLine, zones) || (directoryArea ? zones.find((zone) => zone.active && zone.id === directoryArea.id) : null) || null
  if (named && isPoint(named)) return { point: toPoint(named), zone: named, source: 'AREA_CENTRE' }
  return { point: null, zone: named, source: 'UNKNOWN' }
}

/**
 * Prices the delivery for a food/grocery order. Returns null when delivery pricing is not published (the caller
 * keeps the old flat fee). Throws DeliveryQuoteError when the trip is beyond the maximum distance.
 */
/**
 * Every area that can affect a price: the Sapele areas an admin placed in Delivery pricing, plus delivery zones
 * approved in Admin › Locations (verified, coverage approved, switched on). `approved` can be passed in tests.
 */
export async function pricingZones(db, pricing, approved) {
  const located = approved || (db ? await deliveryZones(db).catch(() => []) : [])
  return [...(pricing.zones || []), ...located]
}

export async function quoteOrderDelivery({ db, restaurant, destination, subtotalMinor, fetchImpl, pricing: givenPricing, finance: givenFinance, zones: givenZones }) {
  const [pricing, finance] = await Promise.all([givenPricing || getDeliveryPricing(db), givenFinance || getFinanceSettings(db)])
  if (!pricing.published) return null
  const zones = await pricingZones(db, pricing, givenZones)
  const fulfilment = plannedFulfilment(restaurant.application?.deliveryPreference)
  const pickupPoint = toPoint(restaurant)
  const pickupZone = pickupPoint ? zoneForPoint(pickupPoint, zones) : null
  const dropoff = resolveDropoff(destination, zones)
  if (dropoff.zone?.closed) throw new DeliveryQuoteError('AREA_PAUSED', `Deliveries to ${dropoff.zone.name} are paused${dropoff.zone.closedReason ? `: ${dropoff.zone.closedReason}` : ''}. Please try again later.`, 409)
  if (dropoff.zone?.minimumOrderMinor && subtotalMinor < dropoff.zone.minimumOrderMinor) throw new DeliveryQuoteError('BELOW_AREA_MINIMUM', `Orders to ${dropoff.zone.name} need at least ₦${(dropoff.zone.minimumOrderMinor / 100).toLocaleString('en-NG')} of food.`, 409)
  if (pricing.coverage?.requireApprovedZone && !dropoff.zone) throw new DeliveryQuoteError('OUTSIDE_COVERAGE', dropoff.point ? 'DOORSTEP doesn’t deliver to this spot yet. Check your map pin, or choose an address inside a DOORSTEP delivery area.' : 'Set your exact delivery pin on the map so we can check DOORSTEP delivers there.', 422)
  let distance
  const extraWarnings = []
  if (pickupPoint && dropoff.point) {
    distance = await measureDelivery(pickupPoint, dropoff.point, pricing.distance, cachedRoutes(fetchImpl))
    if (dropoff.source === 'AREA_CENTRE') extraWarnings.push('AREA_CENTRE')
  } else {
    distance = { meters: Math.round(pricing.distance.assumedKm * 1000), source: 'ASSUMED', straightMeters: null, roadMeters: null, warnings: ['ASSUMED_DISTANCE'] }
    if (!pickupPoint) extraWarnings.push('PICKUP_NOT_PINNED')
  }
  distance.warnings = [...distance.warnings, ...extraWarnings]
  const priced = priceDelivery({ distance, pickupZone, dropoffZone: dropoff.zone, subtotalMinor, fulfilment, pricing, finance: withBusinessCommission(finance, restaurant) })
  if (priced.warnings.includes('BEYOND_MAX_DISTANCE') && distance.source !== 'ASSUMED') {
    throw new DeliveryQuoteError('DELIVERY_TOO_FAR', `This address is about ${priced.km} km from the store. DOORSTEP delivers up to ${pricing.distance.maxDeliveryKm} km in Sapele.`, 422)
  }
  return { ...priced, dropoffSource: dropoff.source, pricedAt: new Date().toISOString() }
}

/** What gets stored on the order so later rate changes never rewrite it. */
export function orderPricingSnapshot(priced) {
  if (!priced) return {}
  const riderPayKnown = priced.rider.payMinor != null && priced.distance.source !== 'ASSUMED'
  return {
    deliveryDistanceMeters: priced.distance.source === 'ASSUMED' ? null : priced.distance.meters,
    plannedRiderPayMinor: riderPayKnown ? priced.rider.payMinor : null,
    deliveryQuote: {
      km: priced.km, distance: priced.distance, dropoffSource: priced.dropoffSource, pickupZone: priced.pickupZone, dropoffZone: priced.dropoffZone,
      rule: priced.rule, customer: priced.customer, rider: priced.rider, commission: priced.commission, serviceFeeMinor: priced.serviceFeeMinor,
      deliveryMarginMinor: priced.deliveryMarginMinor, doorstepRevenueMinor: priced.doorstepRevenueMinor, warnings: priced.warnings, pricedAt: priced.pricedAt,
    },
  }
}

/** Resolves a calculator end point: a business, a Sapele area, or a map pin. */
export async function resolveCalculatorPoint(db, input, zones) {
  if (input?.restaurantId) {
    const restaurant = await db.restaurant.findUnique({ where: { id: input.restaurantId }, select: { id: true, name: true, latitude: true, longitude: true, application: { select: { deliveryPreference: true } } } })
    if (!restaurant) throw new DeliveryQuoteError('BUSINESS_NOT_FOUND', 'That business was not found.', 404)
    const point = toPoint(restaurant)
    if (!point) throw new DeliveryQuoteError('PICKUP_NOT_PINNED', `${restaurant.name} has not set its location on the map yet.`, 422)
    return { point, zone: zoneForPoint(point, zones), label: restaurant.name, fulfilment: plannedFulfilment(restaurant.application?.deliveryPreference) }
  }
  if (input?.zoneId) {
    const zone = zones.find((entry) => entry.id === input.zoneId)
    if (!zone) throw new DeliveryQuoteError('AREA_NOT_FOUND', 'That area was not found.', 404)
    if (!isPoint(zone)) throw new DeliveryQuoteError('AREA_NOT_PLACED', `${zone.name} has no map pin yet. Place it on the map first.`, 422)
    return { point: toPoint(zone), zone, label: zone.name }
  }
  if (isPoint(input)) return { point: toPoint(input), zone: zoneForPoint(input, zones), label: input.label || 'Map pin' }
  throw new DeliveryQuoteError('POINT_REQUIRED', 'Choose a business, an area, or a map pin.', 400)
}
