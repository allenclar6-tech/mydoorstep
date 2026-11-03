// Map settings shared by lightweight helpers. Kept free of mapbox-gl so that importing a
// formatter or the token does not pull the map library into the main bundle.
import { useEffect, useState } from 'react'
import { apiBase } from '../config/apiBase'
import { readConfirmedLocation } from '../location'
import { COVERAGE_BOUNDS, COVERAGE_CENTER, isCoveredPoint } from '../../server/coverage.js'

export const SAPELE_CENTER = [5.6846, 5.8916]

/**
 * Where a map opens and searches look first: the person's confirmed location when it's inside Delta, Edo or
 * Rivers State, otherwise the middle of the three states. [longitude, latitude].
 */
export function defaultMapCenter() {
  try {
    const location = readConfirmedLocation()
    if (location && isCoveredPoint(location)) return [location.longitude, location.latitude]
  } catch { /* storage unavailable */ }
  return COVERAGE_CENTER
}
/** Mapbox bbox for the three covered states: west,south,east,north. */
export const COVERAGE_BBOX = [COVERAGE_BOUNDS.west, COVERAGE_BOUNDS.south, COVERAGE_BOUNDS.east, COVERAGE_BOUNDS.north].join(',')

// Public, browser-side token (pk.*). It is not a secret: restrict it to the DOORSTEP website URLs and the
// public scopes the app needs in the Mapbox account.
// It normally comes from the build, but a build made without it would show "map not configured"
// forever, so the API also serves it (MAPBOX_PUBLIC_TOKEN on Render). Only pk.* tokens are accepted.
const buildToken = import.meta.env.VITE_MAP_PUBLIC_TOKEN || import.meta.env.VITE_MAPBOX_ACCESS_TOKEN || ''
const TOKEN_CACHE_KEY = 'doorstep-map-public-token'
const cachedToken = () => { try { const value = localStorage.getItem(TOKEN_CACHE_KEY) || ''; return value.startsWith('pk.') ? value : '' } catch { return '' } }
export let mapToken = buildToken || cachedToken()
let tokenRequest = null
let tokenResolved = Boolean(buildToken)
const tokenListeners = new Set()

/** Resolves the public token: build value, else the API's runtime config. Never throws. */
export function loadMapToken() {
  if (buildToken) return Promise.resolve(buildToken)
  tokenRequest ||= fetch(`${apiBase}/api/map/config`, { cache: 'no-store' })
    .then((response) => response.ok ? response.json() : null)
    .then((body) => {
      const token = typeof body?.publicToken === 'string' && body.publicToken.startsWith('pk.') ? body.publicToken : ''
      if (body) {
        try { if (token) localStorage.setItem(TOKEN_CACHE_KEY, token); else localStorage.removeItem(TOKEN_CACHE_KEY) } catch { /* private mode */ }
        mapToken = token
      }
      return mapToken
    })
    .catch(() => { tokenRequest = null; return mapToken })
    .finally(() => { tokenResolved = true; tokenListeners.forEach((listener) => listener(mapToken)) })
  return tokenRequest
}

/** React hook: `{ token, resolved }`. `resolved` is false while the API is still being asked. */
export function useMapToken() {
  const [state, setState] = useState({ token: mapToken, resolved: tokenResolved || Boolean(mapToken) })
  useEffect(() => {
    const listener = (token) => setState({ token, resolved: true })
    tokenListeners.add(listener)
    loadMapToken().then(listener)
    return () => { tokenListeners.delete(listener) }
  }, [])
  return state
}
