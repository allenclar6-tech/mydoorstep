import { randomInt } from 'node:crypto'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Parcel (send-a-package) pricing, routing and lifecycle rules.
// Everything that decides money or status lives here, on the server.
// ---------------------------------------------------------------------------

export const PARCEL_PRICING_KEY = 'parcel_pricing'
export const SAPELE_CENTER = { latitude: 5.8916, longitude: 5.6846 }

const minor = z.number().int().min(0).max(100_000_000)

export const parcelServiceSchema = z.object({
  code: z.string().trim().regex(/^[A-Z0-9_]{2,24}$/),
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(200).default(''),
  vehicleTypes: z.array(z.string().trim().min(2).max(40)).max(6).default([]),
  enabled: z.boolean(),
  baseFeeMinor: minor,
  perKmMinor: minor,
  minimumFareMinor: minor,
  maxPackageSize: z.enum(['SMALL', 'MEDIUM', 'LARGE']).default('LARGE'),
}).strict()

export const parcelPricingSchema = z.object({
  enabled: z.boolean(),
  currency: z.literal('NGN'),
  services: z.array(parcelServiceSchema).max(8),
  serviceFee: z.object({
    type: z.enum(['NONE', 'FLAT', 'PERCENT']),
    flatMinor: minor.default(0),
    percent: z.number().min(0).max(30).default(0),
  }).strict(),
  serviceArea: z.object({
    centerLatitude: z.number().min(-90).max(90),
    centerLongitude: z.number().min(-180).max(180),
    radiusKm: z.number().positive().max(200).nullable(),
  }).strict(),
  maxRouteDistanceKm: z.number().positive().max(500).nullable(),
  approvedBy: z.string().max(120).optional(),
}).strict().superRefine((value, context) => {
  const codes = new Set()
  for (const service of value.services) {
    if (codes.has(service.code)) context.addIssue({ code: 'custom', message: `Duplicate service code ${service.code}` })
    codes.add(service.code)
  }
  if (value.enabled && !value.services.some((service) => service.enabled)) context.addIssue({ code: 'custom', message: 'Enable at least one delivery service before enabling parcel bookings.' })
})

// Nothing is priced until DOORSTEP operations approves real fares in Admin -> Parcel pricing.
export const defaultParcelPricing = Object.freeze({
  enabled: false,
  currency: 'NGN',
  services: [],
  serviceFee: { type: 'NONE', flatMinor: 0, percent: 0 },
  serviceArea: { centerLatitude: SAPELE_CENTER.latitude, centerLongitude: SAPELE_CENTER.longitude, radiusKm: null },
  maxRouteDistanceKm: null,
})

export async function getParcelPricing(prisma) {
  const stored = await prisma.platformSetting.findUnique({ where: { key: PARCEL_PRICING_KEY } })
  if (!stored) return structuredClone(defaultParcelPricing)
  const parsed = parcelPricingSchema.safeParse(stored.value)
  if (!parsed.success) {
    console.error('[parcel] stored pricing is invalid; parcel bookings are disabled until it is corrected')
    return { ...structuredClone(defaultParcelPricing), invalidStoredSettings: true }
  }
  return parsed.data
}

export function publicParcelServices(pricing) {
  return pricing.services.filter((service) => service.enabled).map(({ code, name, description, vehicleTypes, maxPackageSize, baseFeeMinor, perKmMinor, minimumFareMinor }) => ({ code, name, description, vehicleTypes, maxPackageSize, baseFeeMinor, perKmMinor, minimumFareMinor }))
}

export class ParcelError extends Error {
  constructor(code, message, status = 400, extra = {}) { super(message); this.code = code; this.status = status; Object.assign(this, extra) }
}

// --------------------------- geography ------------------------------------

export const pointSchema = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) })

export function haversineMeters(a, b) {
  const radians = (value) => value * Math.PI / 180
  const dLat = radians(b.latitude - a.latitude)
  const dLng = radians(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h))
}

export function assertWithinServiceArea(pricing, point, label) {
  const { radiusKm, centerLatitude, centerLongitude } = pricing.serviceArea
  if (radiusKm == null) return
  const distance = haversineMeters({ latitude: centerLatitude, longitude: centerLongitude }, point)
  if (distance > radiusKm * 1000) throw new ParcelError('OUTSIDE_SERVICE_AREA', `The ${label} is outside the DOORSTEP delivery area.`, 422, { field: label })
}

// --------------------------- routing --------------------------------------

const routingToken = () => process.env.MAPBOX_SERVER_TOKEN || process.env.MAPBOX_TOKEN || process.env.MAPBOX_PUBLIC_TOKEN || ''

export function routingConfigured() { return Boolean(routingToken()) }

/**
 * Road routes from Mapbox Directions. Never falls back to straight-line distance.
 * `fetchImpl` is injectable for tests.
 */
export async function fetchRoadRoutes(origin, destination, { alternatives = true, fetchImpl = globalThis.fetch } = {}) {
  const token = routingToken()
  if (!token) throw new ParcelError('ROUTING_NOT_CONFIGURED', 'Road routing is not configured on the server.', 503)
  const coordinates = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordinates}?alternatives=${alternatives}&geometries=geojson&overview=full&steps=false&access_token=${encodeURIComponent(token)}`
  let response
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(12_000) })
  } catch {
    throw new ParcelError('ROUTING_PROVIDER_UNAVAILABLE', 'The routing service could not be reached. Try again shortly.', 502)
  }
  if (response.status === 401 || response.status === 403) {
    console.error('[parcel] routing_token_rejected', JSON.stringify({ status: response.status }))
    throw new ParcelError('ROUTING_TOKEN_REJECTED', 'Road routing is misconfigured on the server.', 503)
  }
  if (response.status === 429) throw new ParcelError('ROUTING_RATE_LIMITED', 'Too many route requests. Wait a moment and try again.', 503)
  let body = null
  try { body = await response.json() } catch { body = null }
  if (response.status === 422 || body?.code === 'NoRoute' || body?.code === 'NoSegment') throw new ParcelError('NO_ROAD_ROUTE', 'No drivable road route connects these two points. Move a pin onto a road or nearby entrance.', 422)
  if (!response.ok || body?.code !== 'Ok' || !Array.isArray(body.routes) || !body.routes.length) throw new ParcelError('ROUTING_PROVIDER_UNAVAILABLE', 'The routing service returned no usable route.', 502)
  return body.routes.slice(0, 3).map((route, index) => {
    if (!Number.isFinite(route.distance) || route.distance <= 0 || !Number.isFinite(route.duration) || route.geometry?.type !== 'LineString') {
      throw new ParcelError('ROUTING_PROVIDER_UNAVAILABLE', 'The routing service returned an invalid route.', 502)
    }
    return { id: String(index), distanceMeters: Math.round(route.distance), durationSeconds: Math.round(route.duration), geometry: route.geometry, provider: 'mapbox-directions-driving' }
  })
}

// --------------------------- pricing --------------------------------------

export function priceRoute(pricing, service, distanceMeters) {
  if (!Number.isInteger(distanceMeters) || distanceMeters <= 0) throw new ParcelError('INVALID_ROUTE_DISTANCE', 'A road distance is required to price this delivery.', 422)
  const baseFeeMinor = service.baseFeeMinor
  const distanceFeeMinor = Math.round(service.perKmMinor * distanceMeters / 1000)
  const fare = baseFeeMinor + distanceFeeMinor
  const minimumFareAdjustmentMinor = Math.max(0, service.minimumFareMinor - fare)
  const fareMinor = fare + minimumFareAdjustmentMinor
  const fee = pricing.serviceFee
  const serviceFeeMinor = fee.type === 'FLAT' ? fee.flatMinor : fee.type === 'PERCENT' ? Math.round(fareMinor * fee.percent / 100) : 0
  const totalMinor = fareMinor + serviceFeeMinor
  return { baseFeeMinor, distanceFeeMinor, minimumFareAdjustmentMinor, fareMinor, serviceFeeMinor, totalMinor, currency: pricing.currency }
}

export function resolveService(pricing, serviceCode, packageSize) {
  if (pricing.invalidStoredSettings) throw new ParcelError('PARCEL_PRICING_INVALID', 'Parcel pricing needs attention from DOORSTEP operations.', 503)
  if (!pricing.enabled) throw new ParcelError('PARCEL_BOOKINGS_DISABLED', 'Package delivery is not available yet. DOORSTEP operations has not published delivery fares.', 503)
  const service = pricing.services.find((item) => item.code === serviceCode && item.enabled)
  if (!service) throw new ParcelError('PARCEL_SERVICE_UNAVAILABLE', 'That delivery service is not available.', 409)
  const sizes = ['SMALL', 'MEDIUM', 'LARGE']
  if (packageSize && sizes.indexOf(packageSize) > sizes.indexOf(service.maxPackageSize)) throw new ParcelError('PACKAGE_TOO_LARGE_FOR_SERVICE', `${service.name} accepts packages up to ${service.maxPackageSize.toLowerCase()} size.`, 422)
  return service
}

export async function quoteParcel({ prisma, pickup, dropoff, serviceCode, packageSize, fetchImpl }) {
  const pricing = await getParcelPricing(prisma)
  const service = resolveService(pricing, serviceCode, packageSize)
  assertWithinServiceArea(pricing, pickup, 'pickup')
  assertWithinServiceArea(pricing, dropoff, 'destination')
  if (haversineMeters(pickup, dropoff) < 20) throw new ParcelError('PICKUP_EQUALS_DESTINATION', 'Pickup and destination are the same place. Move one of the pins.', 422)
  const routes = await fetchRoadRoutes(pickup, dropoff, { fetchImpl })
  const priced = routes.map((route) => ({ ...route, price: priceRoute(pricing, service, route.distanceMeters) }))
  if (pricing.maxRouteDistanceKm != null && priced.every((route) => route.distanceMeters > pricing.maxRouteDistanceKm * 1000)) {
    throw new ParcelError('ROUTE_TOO_LONG', `DOORSTEP delivers parcels up to ${pricing.maxRouteDistanceKm} km by road.`, 422)
  }
  const allowed = pricing.maxRouteDistanceKm == null ? priced : priced.filter((route) => route.distanceMeters <= pricing.maxRouteDistanceKm * 1000)
  return {
    service: { code: service.code, name: service.name },
    currency: pricing.currency,
    routes: allowed,
    pricingSnapshot: { service, serviceFee: pricing.serviceFee, currency: pricing.currency, quotedAt: new Date().toISOString() },
    disclaimer: 'Travel time is an estimate from road routing and is not a delivery guarantee.',
  }
}

// --------------------------- lifecycle ------------------------------------

export const parcelStatusLabels = {
  PENDING_PAYMENT: 'Pending payment',
  PAYMENT_CONFIRMED: 'Payment confirmed',
  SEARCHING_FOR_RIDER: 'Searching for rider',
  RIDER_ASSIGNED: 'Rider assigned',
  RIDER_EN_ROUTE_TO_PICKUP: 'Rider en route to pickup',
  PICKED_UP: 'Package picked up',
  IN_TRANSIT: 'In transit',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
}

// Delivery (rider pipeline) status -> parcel status shown to the customer.
export const parcelStatusByDeliveryStatus = {
  AVAILABLE: 'SEARCHING_FOR_RIDER',
  REQUESTED: 'SEARCHING_FOR_RIDER',
  ACCEPTED: 'RIDER_ASSIGNED',
  GOING_TO_RESTAURANT: 'RIDER_EN_ROUTE_TO_PICKUP',
  ARRIVED_AT_RESTAURANT: 'RIDER_EN_ROUTE_TO_PICKUP',
  PICKED_UP: 'PICKED_UP',
  GOING_TO_CUSTOMER: 'IN_TRANSIT',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
}

export const customerCancellableStatuses = new Set(['PENDING_PAYMENT', 'PAYMENT_CONFIRMED', 'SEARCHING_FOR_RIDER', 'RIDER_ASSIGNED', 'RIDER_EN_ROUTE_TO_PICKUP'])
export const editableStatuses = new Set(['PENDING_PAYMENT'])
export const activeParcelStatuses = new Set(['PAYMENT_CONFIRMED', 'SEARCHING_FOR_RIDER', 'RIDER_ASSIGNED', 'RIDER_EN_ROUTE_TO_PICKUP', 'PICKED_UP', 'IN_TRANSIT'])

export const RIDER_REQUEST_TTL_MS = 2 * 60 * 1000
export const RIDER_AVAILABILITY_LOCATION_MAX_AGE_MS = 10 * 60 * 1000
export const PAYSTACK_PENDING_TTL_MS = 60 * 60 * 1000

export function parcelReference(now = new Date()) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let suffix = ''
  for (let index = 0; index < 6; index += 1) suffix += alphabet[randomInt(alphabet.length)]
  return `DSP-PKG-${now.toISOString().slice(0, 10).replaceAll('-', '')}-${suffix}`
}
