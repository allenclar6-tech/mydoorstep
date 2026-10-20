// Where the browser sends API requests.
// - On the DOORSTEP domains the Cloudflare worker proxies /api, so requests stay same-origin.
// - Elsewhere a build-time VITE_API_BASE_URL wins.
// - Local development falls back to the API on port 4000.
// - Any other host (a preview, or a build made without .env) uses same-origin rather than
//   "localhost", which only exists on a developer's machine and showed up as "Failed to fetch".
const host = globalThis.location?.hostname || ''
const productionHosts = new Set(['mydoorstep.com.co', 'www.mydoorstep.com.co'])
const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost')

export const apiBase = productionHosts.has(host) ? '' : import.meta.env.VITE_API_BASE_URL || (isLocal ? 'http://localhost:4000' : '')
