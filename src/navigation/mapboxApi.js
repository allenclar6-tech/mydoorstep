import { decodePolyline, validPoint } from './navigation.js'

const profiles = { DRIVE: 'driving', WALK: 'walking', BICYCLE: 'cycling' }
const point = ([longitude, latitude]) => ({ latitude, longitude })

export function createMapboxNavigationClient(token, fetchImpl = (...args) => fetch(...args)) {
  async function get(path, parameters, signal) {
    if (!token || !token.startsWith('pk.')) throw new Error('Navigation needs the existing public Mapbox token. Set MAPBOX_PUBLIC_TOKEN on the API (or VITE_MAP_PUBLIC_TOKEN at build time).')
    const url = new URL(`https://api.mapbox.com${path}`)
    Object.entries({ ...parameters, access_token: token }).forEach(([key, value]) => url.searchParams.set(key, String(value)))
    const response = await fetchImpl(url.toString(), { signal, cache: 'no-store' })
    if (!response.ok) {
      if (response.status === 429) throw new Error('Mapbox usage limit reached. Wait before trying again or review the existing plan limits.')
      if ([401, 403].includes(response.status)) throw new Error('Mapbox rejected this token or website. Check the existing token restrictions and enabled services.')
      throw new Error('Mapbox could not complete this request. Try another place or travel mode.')
    }
    return response.json()
  }

  return async (path, { signal, body } = {}) => {
    const request = new URL(path, 'https://navigation.local')
    if (request.pathname === '/search') {
      const query = request.searchParams.get('query')?.trim()
      const session = request.searchParams.get('sessionToken')
      if (!query || query.length < 3 || !session) throw new Error('Enter at least three characters to search.')
      const data = await get('/search/searchbox/v1/suggest', {
        q: query, session_token: session, proximity: '5.6846,5.8916', language: 'en', limit: 5,
      }, signal)
      if (!Array.isArray(data.suggestions)) throw new Error('Mapbox returned an invalid search response.')
      return { suggestions: data.suggestions.filter((item) => item.mapbox_id && item.name).map((item) => ({
        placeId: item.mapbox_id,
        label: [item.name, item.place_formatted || item.full_address].filter(Boolean).join(', '),
      })) }
    }
    if (request.pathname.startsWith('/places/')) {
      const id = decodeURIComponent(request.pathname.slice('/places/'.length))
      const session = request.searchParams.get('sessionToken')
      if (!id || !session) throw new Error('Choose a valid search result.')
      const data = await get(`/search/searchbox/v1/retrieve/${encodeURIComponent(id)}`, { session_token: session }, signal)
      const feature = data.features?.[0]
      const location = feature?.geometry?.coordinates
      if (!Array.isArray(location) || !validPoint(point(location))) throw new Error('This place has no usable coordinates. Choose another result or pin it on the map.')
      return { place: {
        ...point(location), placeId: id,
        label: [feature.properties?.name, feature.properties?.place_formatted || feature.properties?.full_address].filter(Boolean).join(', ') || 'Selected Mapbox place',
      } }
    }
    if (request.pathname !== '/routes' || !body) throw new Error('Unknown navigation request.')
    const { origin, destination, intermediates = [], travelMode = 'DRIVE', preferences = {} } = body
    const waypoints = [origin, ...intermediates, destination]
    if (!profiles[travelMode] || intermediates.length > 8 || waypoints.some((item) => !validPoint(item))) throw new Error('Check the route coordinates, stops and travel mode.')
    const exclude = travelMode === 'DRIVE' ? [
      preferences.avoidTolls && 'toll', preferences.avoidHighways && 'motorway', preferences.avoidFerries && 'ferry',
    ].filter(Boolean).join(',') : ''
    const data = await get(`/directions/v5/mapbox/${profiles[travelMode]}/${waypoints.map((item) => `${item.longitude},${item.latitude}`).join(';')}`, {
      steps: true, geometries: 'polyline', overview: 'full', alternatives: intermediates.length === 0,
      language: 'en', ...(exclude ? { exclude } : {}),
    }, signal)
    if (data.code !== 'Ok' || !data.routes?.length) throw new Error('No route is available for these points and travel mode. Try a nearby accessible road or another mode.')
    return {
      routes: data.routes.slice(0, 3).map((route, index) => {
        if (!route.geometry || !Number.isFinite(route.distance) || !Number.isFinite(route.duration) || !route.legs?.length) throw new Error('Mapbox returned an incomplete route.')
        return {
          id: String(index), description: route.legs.map((leg) => leg.summary).filter(Boolean).join(' / ') || (index ? `Alternative ${index}` : 'Recommended route'),
          distanceMeters: route.distance, durationSeconds: route.duration, encodedPolyline: route.geometry,
          warnings: [],
          legs: route.legs.map((leg) => ({
            distanceMeters: leg.distance, durationSeconds: leg.duration,
            steps: (leg.steps || []).map((step) => {
              const end = step.geometry ? decodePolyline(step.geometry, 1).at(-1) : null
              if (!end) throw new Error('Mapbox returned a route step without geometry.')
              return {
                distanceMeters: step.distance || 0, durationSeconds: step.duration || 0,
                instruction: step.maneuver?.instruction || `Continue${step.name ? ` on ${step.name}` : ' along the route'}.`,
                maneuver: step.maneuver?.type || 'straight',
                endLocation: end,
              }
            }),
          })),
        }
      }),
      calculatedAt: new Date().toISOString(),
    }
  }
}
