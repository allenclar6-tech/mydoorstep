// Sapele delivery pricing — Glovo-style: the customer pays a distance-based delivery fee, the rider is paid from
// DOORSTEP's published rate card, and DOORSTEP keeps the difference plus commission and the service fee.
// Everything here is pure (no database, no network) so it can be unit tested and reused by the admin calculator.
import { riderEarning } from './financeService.js'

export const DELIVERY_PRICING_KEY = 'delivery_pricing'

// Sapele areas DOORSTEP already lists for customers. They start without map pins: an admin places each one on the
// map in Admin › Delivery pricing. Nothing here is a guessed coordinate.
export const SAPELE_AREA_NAMES = [
  'Amukpe', 'Central Sapele', 'New Road', 'Ogodo', 'Sapele Township', 'Market Road', 'Mission Road', 'Warri-Sapele Road',
  'Benin-Sapele Road', 'Urban Area', 'Ugbeyi', 'Okpe Road', 'Oton Road', 'Oghara Junction', 'Estate Area', 'Hospital Road',
  'School Road', 'Water Side', 'Mosogar Road', 'Jesse Road', 'Okirigwe', 'Ogorode', 'Shell Road',
]

export const slug = (value) => String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'area'

export function starterZones(names = SAPELE_AREA_NAMES) {
  return names.map((name) => ({ id: slug(name), name, latitude: null, longitude: null, radiusMeters: 800, customerSurchargeMinor: 0, riderBonusMinor: 0, active: true }))
}

// Starter values are only a starting point for DOORSTEP operations to edit. Nothing changes at checkout until an
// admin presses Publish (until then the old flat ₦800 + 3% stays in place).
export const defaultDeliveryPricing = Object.freeze({
  published: false,
  distance: {
    detourFactor: 1.35, // road distance ≈ straight line × this, used only when road routing is unavailable
    maxRoadToStraightRatio: 2.8, // a "road" route longer than this × the straight line is treated as a bad route
    maxDeliveryKm: 15,
    assumedKm: 4, // used when a business or customer has no map pin; the order is flagged for review
  },
  customerFee: { baseMinor: 70_000, includedKm: 2, perKmMinor: 15_000, minimumMinor: 70_000, maximumMinor: 350_000, roundToMinor: 5_000 },
  serviceFee: { percent: 3, minimumMinor: 0, maximumMinor: 100_000 },
  margin: { protect: true, minimumMinor: 10_000 },
  boost: { active: false, label: 'Rain / busy hours', customerExtraMinor: 20_000, riderExtraMinor: 15_000 },
  zones: starterZones(),
  routeRules: [],
})

// A suggested rider rate card for the calculator's "Use starter rates" button. Not an official rate: Sapele has
// no published rider tariff, so DOORSTEP sets its own and can agree different amounts per route.
export const STARTER_RIDER_BANDS = [
  { upToKm: 2, amountMinor: 50_000 },
  { upToKm: 4, amountMinor: 70_000 },
  { upToKm: 6, amountMinor: 90_000 },
  { upToKm: 8, amountMinor: 110_000 },
]
export const STARTER_RIDER_PER_KM_AFTER_MINOR = 12_000

export function haversineMeters(a, b) {
  const rad = (value) => value * Math.PI / 180
  const dLat = rad(b.latitude - a.latitude)
  const dLng = rad(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h))
}

export const isPoint = (point) => point != null && Number.isFinite(Number(point.latitude)) && Number.isFinite(Number(point.longitude)) && !(Number(point.latitude) === 0 && Number(point.longitude) === 0)
export const toPoint = (point) => isPoint(point) ? { latitude: Number(point.latitude), longitude: Number(point.longitude) } : null
const placed = (zone) => zone.active && isPoint(zone)

/** The area a point falls in: the nearest placed area whose circle contains it. */
export function zoneForPoint(point, zones = []) {
  if (!isPoint(point)) return null
  let best = null
  for (const zone of zones.filter(placed)) {
    const meters = haversineMeters(toPoint(point), toPoint(zone))
    if (meters <= zone.radiusMeters && (!best || meters < best.meters)) best = { zone, meters }
  }
  return best?.zone || null
}

/** An area named in a typed address ("Okpe Road, Sapele"). Longest name wins so "Warri-Sapele Road" beats "Sapele". */
export function zoneForText(text, zones = []) {
  const haystack = String(text || '').toLowerCase()
  if (!haystack) return null
  return [...zones].filter((zone) => zone.active).sort((a, b) => b.name.length - a.name.length).find((zone) => haystack.includes(zone.name.toLowerCase())) || null
}

/**
 * Picks the distance used for pricing from the road routes and the straight line, guarding against the routing
 * mistakes that made earlier prices wrong: no route, a route shorter than the straight line (impossible), or a
 * huge detour caused by a pin snapped to the wrong road.
 */
export function chooseDistance({ straightMeters, roadMeters = [], routingError = null }, distanceSettings) {
  const { detourFactor, maxRoadToStraightRatio } = distanceSettings
  const estimate = Math.round(straightMeters * detourFactor)
  const roads = (roadMeters || []).filter((value) => Number.isFinite(value) && value > 0)
  if (!roads.length) return { meters: estimate, source: 'ESTIMATE', straightMeters: Math.round(straightMeters), roadMeters: null, warnings: [routingError ? 'ROUTING_UNAVAILABLE' : 'NO_ROAD_ROUTE'] }
  const road = Math.min(...roads)
  if (road < straightMeters * 0.95) return { meters: estimate, source: 'ESTIMATE', straightMeters: Math.round(straightMeters), roadMeters: road, warnings: ['ROUTE_SHORTER_THAN_STRAIGHT_LINE'] }
  if (straightMeters >= 300 && road > straightMeters * maxRoadToStraightRatio) {
    return { meters: Math.round(straightMeters * maxRoadToStraightRatio), source: 'ROAD_CAPPED', straightMeters: Math.round(straightMeters), roadMeters: road, warnings: ['LONG_DETOUR_CAPPED'] }
  }
  return { meters: road, source: 'ROAD', straightMeters: Math.round(straightMeters), roadMeters: road, warnings: [] }
}

/** Measures pickup → drop-off. `fetchRoutes(pickup, dropoff)` returns [{ distanceMeters }] and may throw. */
export async function measureDelivery(pickup, dropoff, distanceSettings, fetchRoutes) {
  const straightMeters = haversineMeters(pickup, dropoff)
  let roadMeters = []
  let routingError = null
  if (fetchRoutes) {
    try { roadMeters = (await fetchRoutes(pickup, dropoff)).map((route) => route.distanceMeters) } catch (error) { routingError = error?.code || 'ROUTING_FAILED' }
  } else routingError = 'ROUTING_NOT_CONFIGURED'
  return chooseDistance({ straightMeters, roadMeters, routingError }, distanceSettings)
}

export const roundUpTo = (value, step) => step > 0 ? Math.ceil(value / step) * step : Math.round(value)

export function findRouteRule(rules = [], fromZoneId, toZoneId) {
  if (!fromZoneId || !toZoneId) return null
  return rules.find((rule) => rule.active && ((rule.fromZoneId === fromZoneId && rule.toZoneId === toZoneId) || (rule.bothWays && rule.fromZoneId === toZoneId && rule.toZoneId === fromZoneId))) || null
}

/** Distance part of the customer delivery fee, before areas, boost and margin protection. */
export function distanceFee(km, customerFee) {
  const extraKm = Math.max(0, km - customerFee.includedKm)
  const distanceMinor = Math.round(extraKm * customerFee.perKmMinor)
  const raw = customerFee.baseMinor + distanceMinor
  const clamped = Math.min(Math.max(raw, customerFee.minimumMinor), Math.max(customerFee.maximumMinor, customerFee.minimumMinor))
  return { baseMinor: customerFee.baseMinor, distanceMinor, clampAdjustMinor: clamped - raw, feeMinor: clamped }
}

export function serviceFeeFor(subtotalMinor, serviceFee) {
  const raw = Math.round(subtotalMinor * serviceFee.percent / 100)
  return Math.min(Math.max(raw, serviceFee.minimumMinor), Math.max(serviceFee.maximumMinor, serviceFee.minimumMinor))
}

/**
 * Prices one delivery. `distance` comes from chooseDistance (or { meters, source: 'ASSUMED' }).
 * Returns the customer fee, the rider's pay, and what DOORSTEP earns, with every adjustment itemised.
 */
export function priceDelivery({ distance, pickupZone = null, dropoffZone = null, subtotalMinor = 0, fulfilment = 'DOORSTEP_RIDER', pricing, finance }) {
  const warnings = [...(distance.warnings || [])]
  const km = Math.round(distance.meters / 100) / 10
  const rule = findRouteRule(pricing.routeRules, pickupZone?.id, dropoffZone?.id)
  const businessRider = fulfilment === 'BUSINESS_RIDER'
  const boost = pricing.boost?.active ? pricing.boost : null

  // Customer delivery fee
  const fromDistance = distanceFee(km, pricing.customerFee)
  const ruleFee = rule?.customerFeeMinor != null
  const zoneSurchargeMinor = ruleFee ? 0 : (pickupZone?.customerSurchargeMinor || 0) + (dropoffZone?.customerSurchargeMinor || 0)
  const boostMinor = boost ? boost.customerExtraMinor : 0
  let fee = (ruleFee ? rule.customerFeeMinor : fromDistance.feeMinor) + zoneSurchargeMinor + boostMinor

  // Rider pay (business-owned riders are paid by their business, not DOORSTEP)
  let rider = { payMinor: null, bandMinor: null, zoneBonusMinor: 0, boostMinor: 0, fromRule: false, paidBy: businessRider ? 'BUSINESS' : 'DOORSTEP' }
  if (!businessRider) {
    const zoneBonusMinor = rule?.riderPayMinor != null ? 0 : (pickupZone?.riderBonusMinor || 0) + (dropoffZone?.riderBonusMinor || 0)
    const riderBoost = boost ? boost.riderExtraMinor : 0
    if (rule?.riderPayMinor != null) rider = { ...rider, payMinor: rule.riderPayMinor + riderBoost, fromRule: true, boostMinor: riderBoost }
    else {
      const band = riderEarning(distance.meters, finance)
      if (band.amountMinor == null) warnings.push(band.reason === 'RATES_NOT_PUBLISHED' ? 'RIDER_RATES_NOT_PUBLISHED' : 'RIDER_PAY_UNKNOWN')
      else rider = { ...rider, payMinor: band.amountMinor + zoneBonusMinor + riderBoost, bandMinor: band.amountMinor, zoneBonusMinor, boostMinor: riderBoost }
    }
  }

  // Margin protection: never let a DOORSTEP delivery cost more than it brings in (agreed route fees are respected).
  let marginTopUpMinor = 0
  if (!businessRider && rider.payMinor != null) {
    const floor = rider.payMinor + (pricing.margin.protect ? pricing.margin.minimumMinor : 0)
    if (fee < floor) {
      if (pricing.margin.protect && !ruleFee) marginTopUpMinor = floor - fee
      else warnings.push('NEGATIVE_DELIVERY_MARGIN')
    }
  }
  fee += marginTopUpMinor
  const rounded = roundUpTo(fee, pricing.customerFee.roundToMinor)
  const roundingMinor = rounded - fee
  const deliveryFeeMinor = rounded
  if (!ruleFee && deliveryFeeMinor > pricing.customerFee.maximumMinor) warnings.push('ABOVE_MAXIMUM_FEE')
  if (km > pricing.distance.maxDeliveryKm) warnings.push('BEYOND_MAX_DISTANCE')

  const serviceFeeMinor = serviceFeeFor(subtotalMinor, pricing.serviceFee)
  const commissionPercent = businessRider ? finance.commission.ownRiderPercent : finance.commission.doorstepRiderPercent
  const commissionMinor = Math.round(subtotalMinor * commissionPercent / 100)
  const deliveryMarginMinor = businessRider ? 0 : rider.payMinor == null ? null : deliveryFeeMinor - rider.payMinor
  const doorstepRevenueMinor = deliveryMarginMinor == null ? null : commissionMinor + serviceFeeMinor + deliveryMarginMinor

  return {
    km,
    distance: { meters: distance.meters, source: distance.source, straightMeters: distance.straightMeters ?? null, roadMeters: distance.roadMeters ?? null },
    pickupZone: pickupZone ? { id: pickupZone.id, name: pickupZone.name } : null,
    dropoffZone: dropoffZone ? { id: dropoffZone.id, name: dropoffZone.name } : null,
    rule: rule ? { id: rule.id, agreedWith: rule.agreedWith || '', note: rule.note || '' } : null,
    fulfilment,
    customer: { ...fromDistance, fromRule: ruleFee, ruleFeeMinor: ruleFee ? rule.customerFeeMinor : null, zoneSurchargeMinor, boostMinor, marginTopUpMinor, roundingMinor, deliveryFeeMinor },
    rider,
    serviceFeeMinor,
    commission: { percent: commissionPercent, minor: commissionMinor },
    deliveryMarginMinor,
    doorstepRevenueMinor,
    subtotalMinor,
    customerTotalMinor: subtotalMinor + deliveryFeeMinor + serviceFeeMinor,
    warnings: [...new Set(warnings)],
  }
}

/** Fee / rider pay / margin for each whole kilometre — the "is this balanced?" table on the admin page. */
export function distanceTable({ pricing, finance, maxKm = 12, subtotalMinor = 0, fulfilment = 'DOORSTEP_RIDER' }) {
  return Array.from({ length: maxKm }, (_, index) => {
    const km = index + 1
    const priced = priceDelivery({ distance: { meters: km * 1000, source: 'TABLE', warnings: [] }, subtotalMinor, fulfilment, pricing, finance })
    return { km, deliveryFeeMinor: priced.customer.deliveryFeeMinor, riderPayMinor: priced.rider.payMinor, marginTopUpMinor: priced.customer.marginTopUpMinor, deliveryMarginMinor: priced.deliveryMarginMinor, doorstepRevenueMinor: priced.doorstepRevenueMinor }
  })
}

export const WARNING_TEXT = {
  ROUTING_UNAVAILABLE: 'Road routing was unavailable, so the distance is estimated from the straight line plus a detour allowance.',
  ROUTING_NOT_CONFIGURED: 'Road routing is not configured on the server (MAPBOX_SERVER_TOKEN), so the distance is estimated.',
  NO_ROAD_ROUTE: 'No road route was found, so the distance is estimated.',
  ROUTE_SHORTER_THAN_STRAIGHT_LINE: 'The road route was shorter than the straight line, which means a pin is wrong. The distance is estimated instead.',
  LONG_DETOUR_CAPPED: 'The road route was a very long detour (often a pin on the wrong road). The distance was capped. If this trip really needs the detour, add an agreed price for this route.',
  RIDER_RATES_NOT_PUBLISHED: 'Rider rates are not published yet, so rider pay and the margin cannot be worked out.',
  RIDER_PAY_UNKNOWN: 'Rider pay could not be worked out for this distance.',
  NEGATIVE_DELIVERY_MARGIN: 'The agreed customer fee is less than the rider’s pay, so DOORSTEP loses money on delivery for this route.',
  ABOVE_MAXIMUM_FEE: 'The fee went above your maximum to cover the rider’s pay.',
  BEYOND_MAX_DISTANCE: 'This trip is longer than your maximum delivery distance. Checkout will refuse it.',
  ASSUMED_DISTANCE: 'A map pin is missing, so a typical distance was assumed. The rider’s pay will need checking.',
  AREA_CENTRE: 'The customer chose an area, not an exact pin, so the area’s centre was used.',
  PICKUP_NOT_PINNED: 'This business has not set its location on the map.',
}
