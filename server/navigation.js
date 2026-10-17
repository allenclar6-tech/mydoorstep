import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'

const pointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
}).strict()

export const routeRequestSchema = z.object({
  origin: pointSchema,
  destination: pointSchema,
  intermediates: z.array(pointSchema).max(8).default([]),
  travelMode: z.enum(['DRIVE', 'WALK', 'BICYCLE']).default('DRIVE'),
  preferences: z.object({
    avoidTolls: z.boolean().default(false),
    avoidHighways: z.boolean().default(false),
    avoidFerries: z.boolean().default(false),
  }).strict().default({ avoidTolls: false, avoidHighways: false, avoidFerries: false }),
}).strict().refine((value) => value.travelMode === 'DRIVE' || !Object.values(value.preferences).some(Boolean), {
  message: 'Route avoidance preferences apply to driving only.',
})

const sessionToken = z.string().uuid()
const searchSchema = z.object({ query: z.string().trim().min(3).max(200), sessionToken })
const placeSchema = z.object({ placeId: z.string().regex(/^[A-Za-z0-9_-]+$/).max(250), sessionToken })
const routeMask = [
  'routes.description', 'routes.routeLabels', 'routes.distanceMeters', 'routes.duration',
  'routes.polyline.encodedPolyline', 'routes.warnings',
  'routes.legs.distanceMeters', 'routes.legs.duration', 'routes.legs.endLocation',
  'routes.legs.steps.distanceMeters', 'routes.legs.steps.staticDuration',
  'routes.legs.steps.endLocation', 'routes.legs.steps.navigationInstruction',
].join(',')

class NavigationError extends Error {
  constructor(code, status) {
    super(code)
    this.code = code
    this.status = status
  }
}

function durationSeconds(value) {
  if (typeof value !== 'string' || !/^\d+(\.\d+)?s$/.test(value)) throw new NavigationError('INVALID_ROUTE_RESPONSE', 502)
  return Number(value.slice(0, -1))
}

function normalizeRoutes(data) {
  if (!Array.isArray(data.routes) || !data.routes.length) throw new NavigationError('NO_ROUTE', 404)
  return data.routes.slice(0, 3).map((route, index) => {
    if (!route.polyline?.encodedPolyline || !Number.isFinite(route.distanceMeters) || route.distanceMeters <= 0 || !route.legs?.length) {
      throw new NavigationError('INVALID_ROUTE_RESPONSE', 502)
    }
    return {
      id: String(index),
      description: route.description || (index === 0 ? 'Recommended route' : `Alternative ${index}`),
      distanceMeters: route.distanceMeters,
      durationSeconds: durationSeconds(route.duration),
      encodedPolyline: route.polyline.encodedPolyline,
      warnings: route.warnings || [],
      legs: route.legs.map((leg) => ({
        distanceMeters: leg.distanceMeters,
        durationSeconds: durationSeconds(leg.duration),
        endLocation: pointSchema.parse(leg.endLocation?.latLng),
        steps: (leg.steps || []).map((step) => ({
          distanceMeters: step.distanceMeters || 0,
          durationSeconds: durationSeconds(step.staticDuration || '0s'),
          endLocation: pointSchema.parse(step.endLocation?.latLng),
          instruction: step.navigationInstruction?.instructions || 'Continue along the route.',
          maneuver: step.navigationInstruction?.maneuver || 'STRAIGHT',
        })),
      })),
    }
  })
}

export function createNavigationRouter({ getKey = () => process.env.GOOGLE_NAVIGATION_API_KEY, fetchImpl = (...args) => fetch(...args) } = {}) {
  const router = Router()
  router.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next() })
  router.use(rateLimit({
    windowMs: 60_000,
    limit: 40,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_request, response) => response.status(429).json({ error: 'NAVIGATION_RATE_LIMITED' }),
  }))

  async function googleRequest(url, options, fieldMask) {
    const key = getKey()
    if (!key) throw new NavigationError('NAVIGATION_NOT_CONFIGURED', 503)
    const response = await fetchImpl(url, {
      ...options,
      signal: AbortSignal.timeout(12_000),
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': fieldMask },
    })
    if (!response.ok) {
      console.warn('[navigation] provider_rejected', JSON.stringify({ status: response.status }))
      throw new NavigationError(response.status === 429 ? 'NAVIGATION_PROVIDER_RATE_LIMITED' : 'NAVIGATION_PROVIDER_UNAVAILABLE', 502)
    }
    return response.json()
  }

  function endpoint(handler) {
    return async (request, response) => {
      try {
        return await handler(request, response)
      } catch (error) {
        console.error('[navigation] request_failed', JSON.stringify({ code: error.code || 'NAVIGATION_UNAVAILABLE', name: error.name }))
        return response.status(error instanceof NavigationError ? error.status : 502).json({
          error: error instanceof NavigationError ? error.code : 'NAVIGATION_UNAVAILABLE',
        })
      }
    }
  }

  router.get('/search', endpoint(async (request, response) => {
    const query = searchSchema.safeParse(request.query)
    if (!query.success) return response.status(400).json({ error: 'INVALID_NAVIGATION_SEARCH' })
    const data = await googleRequest('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      body: JSON.stringify({
        input: query.data.query,
        sessionToken: query.data.sessionToken,
        languageCode: 'en',
        locationBias: { circle: { center: { latitude: 5.8916, longitude: 5.6846 }, radius: 50000 } },
      }),
    }, 'suggestions.placePrediction.placeId,suggestions.placePrediction.text')
    const suggestions = (data.suggestions || []).flatMap(({ placePrediction }) =>
      placePrediction?.placeId && placePrediction.text?.text
        ? [{ placeId: placePrediction.placeId, label: placePrediction.text.text }]
        : [])
    return response.json({ suggestions: suggestions.slice(0, 5) })
  }))

  router.get('/places/:placeId', endpoint(async (request, response) => {
    const query = placeSchema.safeParse({ ...request.params, ...request.query })
    if (!query.success) return response.status(400).json({ error: 'INVALID_NAVIGATION_PLACE' })
    const data = await googleRequest(`https://places.googleapis.com/v1/places/${encodeURIComponent(query.data.placeId)}?sessionToken=${encodeURIComponent(query.data.sessionToken)}&languageCode=en`, {
      method: 'GET',
    }, 'id,displayName,formattedAddress,location')
    const point = pointSchema.safeParse(data.location)
    if (!point.success) throw new NavigationError('PLACE_LOCATION_UNAVAILABLE', 404)
    return response.json({
      place: { ...point.data, placeId: data.id || query.data.placeId, label: data.formattedAddress || data.displayName?.text || 'Selected place' },
    })
  }))

  router.post('/routes', endpoint(async (request, response) => {
    const parsed = routeRequestSchema.safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_NAVIGATION_ROUTE' })
    const { origin, destination, intermediates, travelMode, preferences } = parsed.data
    const waypoint = (latLng) => ({ location: { latLng } })
    const data = await googleRequest('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      body: JSON.stringify({
        origin: waypoint(origin),
        destination: waypoint(destination),
        intermediates: intermediates.map(waypoint),
        travelMode,
        computeAlternativeRoutes: intermediates.length === 0,
        polylineQuality: 'HIGH_QUALITY',
        languageCode: 'en',
        units: 'METRIC',
        ...(travelMode === 'DRIVE' ? { routingPreference: 'TRAFFIC_AWARE', routeModifiers: preferences } : {}),
      }),
    }, routeMask)
    return response.json({ routes: normalizeRoutes(data), calculatedAt: new Date().toISOString() })
  }))

  return router
}
