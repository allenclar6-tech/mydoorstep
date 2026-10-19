import { mapToken, SAPELE_CENTER } from './mapConfig'
import { sapeleDeliveryDirectory } from '../data'

export const apiBase = globalThis.location?.hostname === 'mydoorstep.com.co' ? '' : import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

export class SearchError extends Error {
  constructor(code, message) { super(message); this.code = code }
}

export function featureLabel(feature) {
  return feature.properties?.full_address || feature.place_name || [feature.properties?.name, feature.properties?.place_formatted].filter(Boolean).join(', ') || 'Selected map location'
}

function nigeriaQuery(query) {
  if (/\bnigeria\b/i.test(query)) return query
  const directoryMatch = sapeleDeliveryDirectory.find((location) => location.name.toLowerCase() === query.toLowerCase())
  return directoryMatch ? `${directoryMatch.name}, Sapele, Delta State, Nigeria` : `${query}, Nigeria`
}

const statusError = (status, label) => status === 429
  ? new SearchError('RATE_LIMITED', `${label} is busy. Wait a few seconds and try again.`)
  : status === 401 || status === 403
    ? new SearchError('CONFIG', `${label} is not configured correctly for this website.`)
    : new SearchError('UNAVAILABLE', `${label} failed (${status}).`)

/**
 * Searches Mapbox geocoding (addresses, streets, places, POIs) and DOORSTEP's
 * server-side Google Places fallback in parallel. Results are never invented:
 * if neither provider knows a place, the caller is told so.
 */
export async function searchAddresses(query, { signal, proximity = SAPELE_CENTER } = {}) {
  const q = nigeriaQuery(query.trim())
  const [mapboxResult, googleResult, poiResult] = await Promise.allSettled([
    mapToken
      ? fetch(`https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(q)}&country=ng&types=address,street,neighborhood,locality,place&proximity=${proximity.join(',')}&autocomplete=true&limit=8&language=en&access_token=${encodeURIComponent(mapToken)}`, { signal }).then(async (response) => {
        if (!response.ok) throw statusError(response.status, 'Map search')
        return response.json()
      })
      : Promise.resolve({ features: [] }),
    fetch(`${apiBase}/api/locations/google/autocomplete?query=${encodeURIComponent(q)}`, { signal }).then(async (response) => {
      if (response.status === 429) throw statusError(429, 'Place search')
      return response.ok ? response.json() : { results: [] }
    }),
    // Businesses and landmarks (points of interest) come from the Mapbox Search Box API.
    mapToken
      ? fetch(`https://api.mapbox.com/search/searchbox/v1/forward?q=${encodeURIComponent(q)}&country=ng&types=poi&proximity=${proximity.join(',')}&limit=5&language=en&access_token=${encodeURIComponent(mapToken)}`, { signal }).then(async (response) => {
        if (!response.ok) throw statusError(response.status, 'Business search')
        return response.json()
      })
      : Promise.resolve({ features: [] }),
  ])
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const mapbox = mapboxResult.status === 'fulfilled' && Array.isArray(mapboxResult.value.features)
    ? mapboxResult.value.features.filter((feature) => Array.isArray(feature.geometry?.coordinates)).map((feature) => ({
      id: feature.properties?.mapbox_id || feature.id || featureLabel(feature),
      source: 'mapbox',
      name: feature.properties?.name || feature.text || 'Location',
      label: featureLabel(feature),
      coordinates: feature.geometry.coordinates,
      kind: feature.properties?.feature_type || null,
    }))
    : []
  const pois = poiResult.status === 'fulfilled' && Array.isArray(poiResult.value.features)
    ? poiResult.value.features.filter((feature) => Array.isArray(feature.geometry?.coordinates)).map((feature) => ({
      id: feature.properties?.mapbox_id || featureLabel(feature),
      source: 'mapbox-poi',
      name: feature.properties?.name || 'Place',
      label: feature.properties?.full_address || feature.properties?.place_formatted || 'Business or landmark',
      coordinates: feature.geometry.coordinates,
      kind: 'poi',
    }))
    : []
  const google = googleResult.status === 'fulfilled' && Array.isArray(googleResult.value.results)
    ? googleResult.value.results.map((place) => ({ id: place.placeId, source: 'google', placeId: place.placeId, name: place.label, label: place.secondaryLabel || 'Google Places result' }))
    : []
  if (!mapbox.length && !google.length && !pois.length) {
    const failure = [mapboxResult, googleResult].find((result) => result.status === 'rejected')
    if (failure && failure.reason?.name !== 'AbortError') throw failure.reason instanceof SearchError ? failure.reason : new SearchError('UNAVAILABLE', 'Address search is unavailable right now.')
  }
  const seen = new Set()
  const results = [...pois, ...mapbox, ...google].filter((item) => { const key = `${item.source === 'google' ? 'g' : 'm'}:${item.id}`; if (seen.has(key)) return false; seen.add(key); return true })
  return { results, partial: [mapboxResult, googleResult, poiResult].some((result) => result.status === 'rejected') }
}

export async function resolveGooglePlace(placeId) {
  const response = await fetch(`${apiBase}/api/locations/google/${encodeURIComponent(placeId)}`)
  if (!response.ok) throw new SearchError('UNRESOLVED', 'That place could not be located precisely. Choose another result or place the pin manually.')
  const { location } = await response.json()
  if (!Number.isFinite(location?.latitude) || !Number.isFinite(location?.longitude)) throw new SearchError('UNRESOLVED', 'That place has no usable coordinates.')
  return { coordinates: [location.longitude, location.latitude], label: location.label }
}

export async function reverseGeocode({ latitude, longitude }) {
  if (!mapToken) return null
  const response = await fetch(`https://api.mapbox.com/search/geocode/v6/reverse?longitude=${encodeURIComponent(longitude)}&latitude=${encodeURIComponent(latitude)}&language=en&access_token=${encodeURIComponent(mapToken)}`)
  if (!response.ok) throw statusError(response.status, 'Address lookup')
  const data = await response.json()
  return data.features?.[0] ? featureLabel(data.features[0]) : null
}

/** Road routes for on-map preview only. Prices are always computed again by the DOORSTEP server. */
export async function fetchDrivingRoutes(origin, destination, { alternatives = true, signal } = {}) {
  if (!mapToken) throw new SearchError('CONFIG', 'Route preview needs the public Mapbox token.')
  const response = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}?alternatives=${alternatives}&geometries=geojson&overview=full&access_token=${encodeURIComponent(mapToken)}`, { signal })
  if (!response.ok) throw statusError(response.status, 'Routing')
  const body = await response.json()
  if (body.code !== 'Ok' || !body.routes?.length) throw new SearchError('NO_ROUTE', 'No road route connects these points.')
  return body.routes.slice(0, 3).map((route, index) => ({ id: String(index), distanceMeters: Math.round(route.distance), durationSeconds: Math.round(route.duration), geometry: route.geometry }))
}

export function formatDistance(meters) {
  if (!Number.isFinite(meters)) return '—'
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '—'
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

export function describeGeolocationError(error) {
  if (!error) return 'Location is unavailable.'
  if (error.code === 1) return 'Location permission was not granted. Search for the address or tap the map instead.'
  if (error.code === 3) return 'Location timed out. Move to an open area or check your signal, then try again.'
  return 'Your device could not determine a location yet. Try again, or search for the address.'
}

export function getDevicePosition({ timeout = 15_000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject({ code: 2 }); return }
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, maximumAge: 0, timeout })
  })
}
