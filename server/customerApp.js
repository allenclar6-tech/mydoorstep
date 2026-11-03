// Pure helpers for the customer app: "can we deliver here?" and the Discover rankings.
// Kept free of express/prisma imports so they can be unit-tested.
import { resolveDropoff } from './deliveryQuote.js'
import { COVERAGE_LABEL, isCoveredPoint } from './coverage.js'

/**
 * Whether DOORSTEP delivers to a pin or typed address.
 * Returns { deliverable, reason, zone, message } — reason is one of OK, PAUSED, NOT_COVERED, TOO_FAR, UNKNOWN.
 */
export function deliverability({ point, addressLine }, { pricing, zones }) {
  const dropoff = resolveDropoff({ point, addressLine }, zones || [])
  const zone = dropoff.zone ? { id: dropoff.zone.id, name: dropoff.zone.name } : null
  if (dropoff.zone?.closed) return { deliverable: false, reason: 'PAUSED', zone, message: `Deliveries to ${dropoff.zone.name} are paused${dropoff.zone.closedReason ? `: ${dropoff.zone.closedReason}` : ''}.` }
  // Outside Delta, Edo and Rivers States: not served. Inside, the store's distance limit applies at checkout.
  if (dropoff.point && !isCoveredPoint(dropoff.point)) {
    return { deliverable: false, reason: 'TOO_FAR', zone, message: `DOORSTEP delivers in ${COVERAGE_LABEL} only. This address is outside them.` }
  }
  if (pricing?.coverage?.requireApprovedZone && !dropoff.zone) {
    return { deliverable: false, reason: dropoff.point ? 'NOT_COVERED' : 'UNKNOWN', zone: null, message: dropoff.point ? 'DOORSTEP doesn’t deliver to this spot yet.' : 'Set your exact pin on the map so we can check this address.' }
  }
  if (!dropoff.point && !dropoff.zone) return { deliverable: true, reason: 'UNKNOWN', zone: null, message: 'We’ll confirm the exact fee at checkout. Pin your spot on the map for the best price.' }
  return { deliverable: true, reason: 'OK', zone, message: zone ? `DOORSTEP delivers to ${zone.name}.` : 'DOORSTEP delivers here.' }
}

const median = (values) => {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b)
  if (!sorted.length) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

export function medianItemPrice(store) {
  return median((store.items || []).map((item) => Number(item.priceMinor ?? Math.round(Number(item.price || 0) * 100))))
}

/**
 * Discover sections from real activity. stats: Map(storeId → { orders30, delivered30, onTimeRate }).
 * Stores with no activity are never presented as "most in demand".
 */
export function discoverSections(stores, stats, { limit = 10, now = new Date() } = {}) {
  const open = stores.filter((store) => !store.temporarilyClosed)
  const stat = (store) => stats.get(store.id) || { orders30: 0, delivered30: 0 }
  const byDemand = open.filter((store) => stat(store).orders30 > 0).sort((a, b) => stat(b).orders30 - stat(a).orders30)
  const priced = open.map((store) => ({ store, price: medianItemPrice(store) })).filter((entry) => entry.price != null).sort((a, b) => a.price - b.price)
  const rated = open.filter((store) => (store.ratingCount || 0) >= 3).sort((a, b) => (b.rating - a.rating) || (b.ratingCount - a.ratingCount))
  // Top performers: most orders actually delivered, then rating.
  const performers = open.filter((store) => stat(store).delivered30 > 0).sort((a, b) => (stat(b).delivered30 - stat(a).delivered30) || ((b.rating || 0) - (a.rating || 0)))
  const fresh = open.filter((store) => store.createdAt && now - new Date(store.createdAt) < 45 * 86_400_000).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  const ids = (list) => list.slice(0, limit).map((entry) => (entry.store || entry).id)
  return { mostInDemand: ids(byDemand), budgetFriendly: ids(priced), topRated: ids(rated), topPerformers: ids(performers), newest: ids(fresh) }
}

/**
 * Reads what a business typed for its preparation time: "45", "45-70", "45 – 70 mins".
 * Returns { min, max } (max null for a single time) or { error }.
 */
export function parsePrepRange(value) {
  if (value === '' || value == null) return { min: null, max: null }
  if (typeof value === 'number') value = String(value)
  const numbers = String(value).match(/\d+/g)
  if (!numbers || numbers.length > 2 || /[^\d\s\-–—to mins]/i.test(String(value).replace(/minutes?|mins?/gi, ''))) return { error: 'Enter minutes like 45, or a range like 45-70.' }
  const [min, max] = numbers.map(Number)
  if (min < 1 || min > 240 || (max != null && (max < 1 || max > 240))) return { error: 'Preparation time must be between 1 and 240 minutes.' }
  if (max != null && max < min) return { error: 'The second number must be bigger than the first, like 45-70.' }
  return { min, max: max != null && max !== min ? max : null }
}

/** A rough, honest delivery time range for a store card (prep time plus a typical Sapele ride). */
export function etaRange(store, { orderType = 'DELIVERY' } = {}) {
  const prep = Number(store.prepTimeMinutes) || 20
  const prepMax = Number(store.prepTimeMaxMinutes) > prep ? Number(store.prepTimeMaxMinutes) : null
  const round = (value) => Math.round(value / 5) * 5
  if (orderType === 'PICKUP') return prepMax ? [prep, prepMax] : [prep, prep + 10]
  return prepMax ? [round(prep + 10), round(prepMax + 15)] : [round(prep + 10), round(prep + 25)]
}
