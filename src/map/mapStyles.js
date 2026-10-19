// Basemap styles offered by the Layers button. Each one is probed against the
// configured public token before it is presented as available.
export const MAP_STYLES = [
  { id: 'standard', name: 'Standard', url: 'mapbox://styles/mapbox/standard', slug: 'standard', swatch: ['#f2efe9', '#c9dfc4', '#9fc3e6'] },
  { id: 'streets', name: 'Streets', url: 'mapbox://styles/mapbox/streets-v12', slug: 'streets-v12', swatch: ['#f6f4ee', '#ffd27a', '#a7d3a1'] },
  { id: 'light', name: 'Light', url: 'mapbox://styles/mapbox/light-v11', slug: 'light-v11', swatch: ['#fafafa', '#e5e5e5', '#cfd8dc'] },
  { id: 'dark', name: 'Dark', url: 'mapbox://styles/mapbox/dark-v11', slug: 'dark-v11', swatch: ['#1d1f21', '#3b3f45', '#5c6670'] },
  { id: 'satellite', name: 'Satellite', url: 'mapbox://styles/mapbox/satellite-v9', slug: 'satellite-v9', swatch: ['#3d4b2f', '#6b7a4a', '#2f3e46'] },
  { id: 'satellite-streets', name: 'Satellite Streets', url: 'mapbox://styles/mapbox/satellite-streets-v12', slug: 'satellite-streets-v12', swatch: ['#3d4b2f', '#f0c36a', '#2f3e46'] },
  { id: 'outdoors', name: 'Outdoors', url: 'mapbox://styles/mapbox/outdoors-v12', slug: 'outdoors-v12', swatch: ['#eef1e4', '#b8d39c', '#c7a676'] },
  { id: 'navigation-day', name: 'Navigation Day', url: 'mapbox://styles/mapbox/navigation-day-v1', slug: 'navigation-day-v1', swatch: ['#f4f3ef', '#ffffff', '#7da7d9'] },
  { id: 'navigation-night', name: 'Navigation Night', url: 'mapbox://styles/mapbox/navigation-night-v1', slug: 'navigation-night-v1', swatch: ['#1c2633', '#33475c', '#5d85b3'] },
]

export const DEFAULT_STYLE_ID = 'standard'
const PREFERENCE_KEY = 'doorstep-map-style'
const PROBE_KEY = 'doorstep-map-style-probe-v1'

export const styleById = (id) => MAP_STYLES.find((style) => style.id === id) || MAP_STYLES[0]

export function readPreferredStyleId() {
  try {
    const stored = localStorage.getItem(PREFERENCE_KEY)
    return MAP_STYLES.some((style) => style.id === stored) ? stored : DEFAULT_STYLE_ID
  } catch { return DEFAULT_STYLE_ID }
}

export function savePreferredStyleId(id) {
  try { localStorage.setItem(PREFERENCE_KEY, id) } catch { /* preference is a convenience only */ }
}

export function describeStyleStatus(status) {
  if (status === 401) return 'The Mapbox token was rejected (missing or invalid).'
  if (status === 403) return 'The Mapbox token is not allowed on this website or lacks the styles permission.'
  if (status === 404) return 'This style is not available to the configured Mapbox account.'
  if (status === 429) return 'Mapbox rate limit reached. Try again shortly.'
  if (status === 0) return 'Could not reach Mapbox. Check the connection.'
  return `Mapbox returned an error (${status}).`
}

let probePromise = null

/**
 * Asks the Mapbox Styles API whether each offered style can be loaded with this
 * token from this website. Results are cached for the browser session.
 * Returns { [styleId]: { ok: boolean, status: number, reason?: string } }.
 */
export function probeStyles(token, { force = false } = {}) {
  if (!token) return Promise.resolve(Object.fromEntries(MAP_STYLES.map((style) => [style.id, { ok: false, status: 401, reason: 'No public Mapbox token is configured for this build.' }])))
  if (!force) {
    try {
      const cached = JSON.parse(sessionStorage.getItem(PROBE_KEY) || 'null')
      if (cached && cached.origin === window.location.origin) return Promise.resolve(cached.results)
    } catch { /* ignore cache problems */ }
    if (probePromise) return probePromise
  }
  probePromise = Promise.all(MAP_STYLES.map(async (style) => {
    try {
      const response = await fetch(`https://api.mapbox.com/styles/v1/mapbox/${style.slug}?access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(10_000) })
      return [style.id, response.ok ? { ok: true, status: response.status } : { ok: false, status: response.status, reason: describeStyleStatus(response.status) }]
    } catch {
      return [style.id, { ok: false, status: 0, reason: describeStyleStatus(0), transient: true }]
    }
  })).then((entries) => {
    const results = Object.fromEntries(entries)
    // Network failures are not cached so a later retry can succeed.
    if (!Object.values(results).some((result) => result.transient)) {
      try { sessionStorage.setItem(PROBE_KEY, JSON.stringify({ origin: window.location.origin, results })) } catch { /* ignore */ }
    }
    probePromise = null
    return results
  })
  return probePromise
}
