
const messages = {
  NAVIGATION_NOT_CONFIGURED: 'Google navigation is not configured on the API. The site owner must set the server-side Google navigation key.',
  NAVIGATION_RATE_LIMITED: 'Too many navigation requests. Please wait a minute and try again.',
  NAVIGATION_PROVIDER_RATE_LIMITED: 'Google navigation has reached its request quota. Please try again later.',
  NAVIGATION_PROVIDER_UNAVAILABLE: 'Google could not complete this request. Check enabled APIs, key restrictions, billing, or try a different place.',
  NO_ROUTE: 'No route is available for these points and travel mode. Try another mode or move the destination to an accessible road.',
  PLACE_LOCATION_UNAVAILABLE: 'That place has no usable coordinates. Choose another result or select it on the map.',
  INVALID_NAVIGATION_ROUTE: 'Check your start, stops, travel mode and route settings.',
}

export async function navigationRequest(path, { signal, body } = {}) {
  try {
    const timeout = AbortSignal.timeout(20000)
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
    if (navigationProvider === 'mapbox') return await mapboxRequest(path, { signal: requestSignal, body })
    const response = await fetch(`${apiBase}/api/navigation${path}`, {
      method: body ? 'POST' : 'GET',
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      signal: requestSignal,
      cache: 'no-store',
    })
    const data = await response.json()
    if (!response.ok) throw new Error(messages[data.error] || 'Navigation is temporarily unavailable. Please try again.')
    return data
  } catch (error) {
    if (error.name === 'TimeoutError') throw new Error('Navigation took too long. Check your connection and try again.')
    if (error instanceof TypeError) throw new Error('Cannot reach the navigation service. Check your connection and API configuration.')
    if (error instanceof SyntaxError) throw new Error('The navigation service returned an invalid response. Check the API deployment.')
    throw error
  }
}

export const routePoint = ({ latitude, longitude }) => ({ latitude, longitude })
import { createMapboxNavigationClient } from './mapboxApi'
import { loadMapToken } from '../map/mapConfig'
import { apiBase } from '../config/apiBase'

export const navigationProvider = import.meta.env.VITE_NAVIGATION_PROVIDER === 'google' ? 'google' : 'mapbox'
export const navigationProviderName = navigationProvider === 'google' ? 'Google' : 'Mapbox'
// Built per call so a public token loaded at runtime (see map/mapConfig) is picked up.
const mapboxRequest = async (path, options) => createMapboxNavigationClient(await loadMapToken())(path, options)
