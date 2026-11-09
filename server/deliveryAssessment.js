// How much DOORSTEP can trust a delivery distance, and when a person must confirm the delivery fee instead.
// Pure functions (no database, no network) so every rule here is unit-tested.
//
// Distance statuses
//   VERIFIED_ROAD_DISTANCE  a road route between two exact pins that passed the sanity checks
//   ESTIMATED_ROAD_DISTANCE a road route that was capped, or measured to an area's centre instead of an exact pin
//   STRAIGHT_LINE_DISTANCE  no usable road route: straight line × detour allowance (never shown as a road distance)
//   UNVERIFIED_DISTANCE     a road route, but the business's own pin is missing (its area centre was used)
//   UNAVAILABLE_DISTANCE    no pin for the customer or the business: nothing could be measured
//
// Confidence (from the facts above only; no invented scores): HIGH › MEDIUM › LOW › UNVERIFIED.

export const DISTANCE_STATUSES = ['VERIFIED_ROAD_DISTANCE', 'ESTIMATED_ROAD_DISTANCE', 'STRAIGHT_LINE_DISTANCE', 'UNVERIFIED_DISTANCE', 'UNAVAILABLE_DISTANCE']
export const CONFIDENCE = ['HIGH', 'MEDIUM', 'LOW', 'UNVERIFIED']
const rank = (level) => ({ HIGH: 3, MEDIUM: 2, LOW: 1, UNVERIFIED: 0 })[level] ?? 0

/** Distance status for a priced delivery (from deliveryPricing.priceDelivery / quoteOrderDelivery). */
export function distanceStatus(priced) {
  const source = priced?.distance?.source
  const warnings = priced?.warnings || []
  if (!source || source === 'ASSUMED') return 'UNAVAILABLE_DISTANCE'
  if (source === 'ESTIMATE') return 'STRAIGHT_LINE_DISTANCE'
  if (warnings.includes('PICKUP_AREA_CENTRE')) return 'UNVERIFIED_DISTANCE'
  if (source === 'ROAD_CAPPED' || priced.dropoffSource === 'AREA_CENTRE' || warnings.includes('AREA_CENTRE')) return 'ESTIMATED_ROAD_DISTANCE'
  return 'VERIFIED_ROAD_DISTANCE'
}

/**
 * HIGH: verified road route between exact pins. MEDIUM: road route with a capped detour or an area centre, or a
 * straight-line measurement between the store's exact pin and the customer's exact pin (when road routing isn't
 * available; the km is straight line × the detour allowance and is shown as an estimate, never as road distance).
 * LOW: straight line from an area centre, or an unpinned business. UNVERIFIED: nothing measured.
 */
export function locationConfidence(status, priced = null, { trustExactPins = true } = {}) {
  if (status === 'STRAIGHT_LINE_DISTANCE' && trustExactPins && exactPins(priced)) return 'MEDIUM'
  return { VERIFIED_ROAD_DISTANCE: 'HIGH', ESTIMATED_ROAD_DISTANCE: 'MEDIUM', UNVERIFIED_DISTANCE: 'LOW', STRAIGHT_LINE_DISTANCE: 'LOW', UNAVAILABLE_DISTANCE: 'UNVERIFIED' }[status] || 'UNVERIFIED'
}

/** Both ends are exact map pins: the store's own pin and the customer's pin (not an area centre or a guess). */
export function exactPins(priced) {
  const warnings = priced?.warnings || []
  return Boolean(priced?.distance) && priced.distance.source !== 'ASSUMED' && priced.dropoffSource === 'PIN' && !warnings.includes('PICKUP_AREA_CENTRE') && !warnings.includes('AREA_CENTRE') && !warnings.includes('PICKUP_NOT_PINNED')
}

/**
 * Why this delivery needs a person to confirm the fee ([] = the automatic price can be charged).
 * A fixed area price or agreed route price is a decision DOORSTEP already made, so it never needs a quote for
 * distance reasons. `settings` is pricing.manualQuotes.
 */
export function manualQuoteReasons(priced, settings, { maxDeliveryKm } = {}) {
  // No published prices, or nothing could be measured: there is no honest automatic price (no flat or "typical
  // trip" fee is charged any more), so a person always confirms it — even when manual quotes are switched off.
  if (!priced) return ['PRICING_NOT_PUBLISHED']
  const fixed = ['AREA_FIXED', 'ROUTE_RULE'].includes(priced.method)
  if (!fixed && priced.distance?.source === 'ASSUMED') return ['LOCATION_NOT_MAPPED']
  if (!settings?.enabled) return []
  const reasons = []
  const status = distanceStatus(priced)
  if (!fixed && rank(locationConfidence(status, priced, { trustExactPins: settings.autoPriceExactPins !== false })) < rank(settings.minConfidence)) reasons.push(status === 'UNAVAILABLE_DISTANCE' ? 'LOCATION_NOT_MAPPED' : 'DISTANCE_NOT_RELIABLE')
  if (!fixed && settings.quoteBeyondMaxDistance && maxDeliveryKm && priced.km > maxDeliveryKm) reasons.push('BEYOND_NORMAL_DISTANCE')
  if (settings.maxAutoFeeMinor != null && priced.customer?.deliveryFeeMinor > settings.maxAutoFeeMinor) reasons.push('FEE_ABOVE_AUTO_LIMIT')
  return reasons
}

export const REASON_TEXT = {
  LOCATION_NOT_MAPPED: 'The address couldn’t be placed on the map.',
  DISTANCE_NOT_RELIABLE: 'The road distance couldn’t be measured reliably.',
  BEYOND_NORMAL_DISTANCE: 'The address is further than the normal delivery distance.',
  FEE_ABOVE_AUTO_LIMIT: 'The calculated fee is above the limit for automatic prices.',
  PRICING_NOT_PUBLISHED: 'Delivery prices for this area are being set up.',
}

/** The distance record kept with every priced order: kilometres, provider, time, both ends, route status. */
export function distanceRecord(priced, { pickup = null, dropoff = null, provider = 'mapbox', at = new Date() } = {}) {
  const status = distanceStatus(priced)
  const routeStatus = !priced?.distance ? 'NOT_MEASURED'
    : priced.distance.source === 'ROAD' ? 'OK'
      : priced.distance.source === 'ROAD_CAPPED' ? 'CAPPED_DETOUR'
        : priced.distance.source === 'ASSUMED' ? 'NOT_MEASURED'
          : (priced.warnings || []).includes('ROUTING_NOT_CONFIGURED') ? 'ROUTING_NOT_CONFIGURED'
            : (priced.warnings || []).includes('ROUTING_UNAVAILABLE') ? 'ROUTING_UNAVAILABLE'
              : (priced.warnings || []).includes('ROUTE_SHORTER_THAN_STRAIGHT_LINE') ? 'SUSPICIOUS_ROUTE' : 'NO_ROUTE'
  return {
    km: status === 'UNAVAILABLE_DISTANCE' ? null : priced.km,
    provider: priced?.distance?.roadMeters != null ? provider : 'none',
    calculatedAt: at.toISOString(),
    origin: pickup,
    destination: dropoff,
    routeStatus,
    verificationStatus: status,
    confidence: locationConfidence(status, priced),
    straightLineKm: priced?.distance?.straightMeters != null ? Math.round(priced.distance.straightMeters / 100) / 10 : null,
    roadKm: priced?.distance?.roadMeters != null ? Math.round(priced.distance.roadMeters / 100) / 10 : null,
  }
}

/* -------------------------------------- quotations -------------------------------------- */
export const QUOTE_STATUSES = ['PENDING_REVIEW', 'QUOTE_SENT', 'CUSTOMER_REVIEW_REQUESTED', 'QUOTE_REVISED', 'QUOTE_ACCEPTED', 'QUOTE_DECLINED', 'QUOTE_EXPIRED', 'QUOTE_CANCELLED']
export const OPEN_QUOTE_STATUSES = ['PENDING_REVIEW', 'QUOTE_SENT', 'CUSTOMER_REVIEW_REQUESTED', 'QUOTE_REVISED', 'QUOTE_EXPIRED']
const AWAITING_CUSTOMER = ['QUOTE_SENT', 'QUOTE_REVISED']

export class QuoteError extends Error {
  constructor(code, message, status = 409) { super(message); this.code = code; this.status = status }
}

export const isExpired = (quote, now = new Date()) => Boolean(quote.expiresAt && new Date(quote.expiresAt) <= now)

/** Admin sends (or revises) a price. Allowed while the request is open; a revision needs fresh acceptance. */
export function checkOffer(quote, { feeMinor, maxQuoteMinor }) {
  if (!OPEN_QUOTE_STATUSES.includes(quote.status)) throw new QuoteError('QUOTE_CLOSED', 'This request is closed. The order was accepted, declined or cancelled.')
  if (!Number.isInteger(feeMinor) || feeMinor < 0) throw new QuoteError('INVALID_FEE', 'Enter a delivery fee of ₦0 or more.', 400)
  if (maxQuoteMinor != null && feeMinor > maxQuoteMinor) throw new QuoteError('FEE_ABOVE_LIMIT', `Quotes above ₦${(maxQuoteMinor / 100).toLocaleString('en-NG')} need the limit raised in Delivery pricing first.`, 403)
  return quote.currentVersion > 0 ? 'QUOTE_REVISED' : 'QUOTE_SENT'
}

/**
 * Customer answers the current offer. `version` must be the version they were shown (stale or replayed answers
 * are refused), and an expired offer can never be accepted.
 */
export function checkResponse(quote, { action, version, maxRounds, now = new Date() }) {
  if (!AWAITING_CUSTOMER.includes(quote.status)) {
    if (quote.status === 'QUOTE_ACCEPTED') throw new QuoteError('ALREADY_ACCEPTED', 'You’ve already accepted this delivery price.')
    if (quote.status === 'CUSTOMER_REVIEW_REQUESTED') throw new QuoteError('REVIEW_PENDING', 'DOORSTEP is reviewing your request. You’ll get an updated price soon.')
    if (quote.status === 'QUOTE_EXPIRED') throw new QuoteError('QUOTE_EXPIRED', 'This price has expired. DOORSTEP will send you a new one.')
    throw new QuoteError('NO_PRICE_TO_ANSWER', 'There’s no delivery price waiting for your answer.')
  }
  if (version !== quote.currentVersion) throw new QuoteError('QUOTE_CHANGED', 'The delivery price has changed. Please check the new price.')
  if (isExpired(quote, now)) throw new QuoteError('QUOTE_EXPIRED', 'This price has expired. DOORSTEP will send you a new one.')
  // Customers don't negotiate: DOORSTEP sets the price with its riders; the customer accepts it or declines it.
  if (action === 'REVIEW') throw new QuoteError('REVIEW_NOT_AVAILABLE', 'Delivery prices are set by DOORSTEP. Accept the price to continue, or decline it to cancel without paying.')
  return { ACCEPT: 'QUOTE_ACCEPTED', DECLINE: 'QUOTE_DECLINED', REVIEW: 'CUSTOMER_REVIEW_REQUESTED' }[action] || (() => { throw new QuoteError('INVALID_ACTION', 'Unknown answer.', 400) })()
}

/** New order totals once a delivery fee is agreed. Discounts never exceed what's being paid. */
export function totalsWithDeliveryFee(order, feeMinor) {
  const gross = order.subtotalMinor + feeMinor + order.serviceFeeMinor + (order.tipMinor || 0)
  const discountMinor = Math.min(order.discountMinor || 0, gross)
  return { deliveryFeeMinor: feeMinor, discountMinor, totalMinor: gross - discountMinor }
}

/** The business moved its pin after the price was set: the price no longer fits the trip. */
export function pickupMoved(snapshot, restaurant, toleranceMeters = 200) {
  if (!snapshot?.latitude || restaurant?.latitude == null) return false
  const rad = (value) => value * Math.PI / 180
  const a = { latitude: Number(snapshot.latitude), longitude: Number(snapshot.longitude) }
  const b = { latitude: Number(restaurant.latitude), longitude: Number(restaurant.longitude) }
  const h = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h)) > toleranceMeters
}

/** Customer-facing wording for each status (no kilometres or GPS jargon). */
export const QUOTE_STATUS_TEXT = {
  PENDING_REVIEW: 'Your location needs a quick review. We’ll confirm your delivery fee shortly.',
  QUOTE_SENT: 'Your delivery price is ready.',
  QUOTE_REVISED: 'Your revised delivery price is ready.',
  CUSTOMER_REVIEW_REQUESTED: 'We’re reviewing your request for a better price.',
  QUOTE_ACCEPTED: 'Delivery price confirmed.',
  QUOTE_DECLINED: 'You declined the delivery price.',
  QUOTE_EXPIRED: 'The delivery price expired. We’ll send you a new one.',
  QUOTE_CANCELLED: 'This delivery price request was cancelled.',
}
