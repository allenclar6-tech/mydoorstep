import { apiBase } from '../config/apiBase'

let cache = null
/** Whether DOORSTEP delivers to a named area right now (server decides; only approved zones count). */
export async function areaAvailability(text) {
  try {
    if (!cache || Date.now() - cache.at > 120_000) {
      const response = await fetch(`${apiBase}/api/delivery/areas`)
      if (!response.ok) return null
      cache = { at: Date.now(), body: await response.json() }
    }
    const { requireApprovedZone, areas = [] } = cache.body
    const haystack = String(text || '').toLowerCase()
    const match = areas.find((area) => haystack.includes(area.name.toLowerCase()))
    if (match?.closed) return { ok: false, message: `Deliveries to ${match.name} are paused${match.closedReason ? `: ${match.closedReason}` : ''}.` }
    if (match) return { ok: true, message: `${match.name} is a DOORSTEP delivery area.` }
    if (requireApprovedZone) return { ok: false, message: 'DOORSTEP doesn’t deliver to this area yet. Set your exact pin on the map to check, or choose another address.' }
    return null
  } catch { return null }
}
