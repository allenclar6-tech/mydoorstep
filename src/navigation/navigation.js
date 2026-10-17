const earthRadius = 6371000
const radians = (degrees) => degrees * Math.PI / 180
export const emptyPreferences = { avoidTolls: false, avoidHighways: false, avoidFerries: false }
export const routeColors = ['#4169e1', '#8756c8', '#668da7']

export function validPoint(point) {
  return Boolean(point && Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90
    && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180)
}

export function distanceBetween(a, b) {
  const dLat = radians(b.latitude - a.latitude)
  const dLng = radians(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLng / 2) ** 2
  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function decodePolyline(encoded, minimumPoints = 2) {
  if (typeof encoded !== 'string' || encoded.length > 1_000_000) throw new Error('The route geometry is invalid.')
  let index = 0
  let latitude = 0
  let longitude = 0
  const points = []
  const read = () => {
    let result = 0
    let shift = 0
    let byte
    do {
      if (index >= encoded.length || shift > 30) throw new Error('The route geometry is incomplete.')
      byte = encoded.charCodeAt(index++) - 63
      if (byte < 0 || byte > 63) throw new Error('The route geometry is invalid.')
      result |= (byte & 31) << shift
      shift += 5
    } while (byte >= 32)
    return result & 1 ? ~(result >> 1) : result >> 1
  }
  while (index < encoded.length) {
    latitude += read()
    longitude += read()
    const point = { latitude: latitude / 1e5, longitude: longitude / 1e5 }
    if (!validPoint(point)) throw new Error('The route contains invalid coordinates.')
    points.push(point)
  }
  if (points.length < minimumPoints) throw new Error('The route has too few points.')
  return points
}

export function measurePath(points) {
  let total = 0
  return points.map((point, index) => {
    if (index) total += distanceBetween(points[index - 1], point)
    return { ...point, along: total }
  })
}

export function projectOnRoute(point, path, minimumAlong = 0) {
  let nearest = { distance: Infinity, along: 0 }
  const scale = Math.max(0.00001, Math.cos(radians(point.latitude)))
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1]
    const b = path[i]
    if (b.along < minimumAlong) continue
    const ax = radians(a.longitude - point.longitude) * earthRadius * scale
    const ay = radians(a.latitude - point.latitude) * earthRadius
    const dx = radians(b.longitude - a.longitude) * earthRadius * scale
    const dy = radians(b.latitude - a.latitude) * earthRadius
    const lengthSquared = dx * dx + dy * dy
    const t = lengthSquared ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared)) : 0
    const distance = Math.hypot(ax + t * dx, ay + t * dy)
    if (distance < nearest.distance) nearest = { distance, along: a.along + t * (b.along - a.along) }
  }
  return nearest
}

export function prepareRoute(route) {
  const path = measurePath(decodePolyline(route.encodedPolyline))
  let previousEnd = 0
  const steps = route.legs.flatMap((leg, legIndex) => leg.steps.map((step) => {
    const projected = projectOnRoute(step.endLocation, path, previousEnd)
    previousEnd = Math.max(previousEnd, projected.along)
    return { ...step, legIndex, endAlong: previousEnd }
  }))
  return { ...route, path, steps, geometryDistance: path.at(-1).along }
}

export function navigationProgress(route, position, previousAlong = 0) {
  const projected = projectOnRoute(position, route.path, Math.max(0, previousAlong - 35))
  const along = Math.max(previousAlong, projected.along)
  const step = route.steps.find((item) => item.endAlong > along + 8) || route.steps.at(-1)
  const fraction = route.geometryDistance ? Math.min(1, along / route.geometryDistance) : 0
  return {
    along,
    offRouteMeters: projected.distance,
    step,
    nextTurnMeters: step ? Math.max(0, step.endAlong - along) : 0,
    remainingMeters: Math.max(0, route.distanceMeters * (1 - fraction)),
    remainingSeconds: Math.max(0, route.durationSeconds * (1 - fraction)),
  }
}

export function formatDistance(meters) {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`
}

export function formatDuration(seconds) {
  const minutes = Math.max(1, Math.ceil(seconds / 60))
  return minutes >= 60 ? `${Math.floor(minutes / 60)} hr ${minutes % 60} min` : `${minutes} min`
}

export function arrivalTime(seconds) {
  return new Date(Date.now() + seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function planPoint(point) {
  if (!validPoint(point)) throw new Error('This shared route has invalid coordinates.')
  return { latitude: point.latitude, longitude: point.longitude, label: typeof point.label === 'string' ? point.label.slice(0, 160) : 'Shared point' }
}

export function parseSharedPlan(search) {
  const value = new URLSearchParams(search).get('plan')
  if (!value) return null
  if (value.length > 6000) throw new Error('This shared route is too large.')
  const plan = JSON.parse(value)
  if (!['DRIVE', 'WALK', 'BICYCLE'].includes(plan.mode) || !Array.isArray(plan.stops) || !plan.stops.length || plan.stops.length > 9) {
    throw new Error('This shared route is invalid.')
  }
  const preferences = plan.preferences === undefined ? emptyPreferences : plan.preferences
  if (!preferences || typeof preferences !== 'object' || Object.keys(preferences).some((key) => !Object.hasOwn(emptyPreferences, key))
    || Object.keys(emptyPreferences).some((key) => typeof preferences[key] !== 'boolean')) {
    throw new Error('This shared route has invalid preferences.')
  }
  return { origin: planPoint(plan.origin), stops: plan.stops.map(planPoint), mode: plan.mode, preferences }
}

export function sharePlanUrl(origin, stops, mode, baseUrl, preferences = emptyPreferences) {
  const url = new URL('/navigate', baseUrl)
  url.searchParams.set('plan', JSON.stringify({ origin: planPoint(origin), stops: stops.map(planPoint), mode, preferences }))
  return url.toString()
}

export function gpsErrorMessage(error) {
  if (error.code === 1) return 'Location permission was denied. Allow location in your browser settings, or choose a start point manually.'
  if (error.code === 2) return 'Your device cannot find a GPS position. Move to an open area and try again.'
  return 'GPS timed out. Check your device location settings and try again.'
}
