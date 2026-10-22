// DOORSTEP money rules. Amounts are kobo (minor units).
//
// Customer → pays DOORSTEP through Paystack. With a Paystack split, the business's share is settled by Paystack
// straight to the business's bank; DOORSTEP keeps its commission, the service fee and (when a DOORSTEP rider
// delivers) the delivery fee. Rider earnings are recorded per delivery and paid out from DOORSTEP's balance.
// Every movement is written to LedgerEntry so each party can see exactly what they are owed and why.

export const defaultFinanceSettings = Object.freeze({
  commission: { doorstepRiderPercent: 15, ownRiderPercent: 10 },
  riderPay: { enabled: false, bands: [], perKmAfterMinor: 0 },
  split: { enabled: true, feeBearer: 'account' },
  riderFee: { percent: 6 },
})

/**
 * DOORSTEP's fee on one rider earning: the rider's statement shows the full earning and the fee as a deduction,
 * and the fee is DOORSTEP income. `source` identifies the delivery (e.g. `order:<id>`) so it is written once.
 */
export function riderFeeEntries({ riderId, orderId = null, parcelBookingId = null, source, label }, earningMinor, settings) {
  const percent = settings.riderFee?.percent ?? 0
  const feeMinor = Math.round(earningMinor * percent / 100)
  if (!(feeMinor > 0)) return []
  const base = { ...(orderId ? { orderId } : {}), ...(parcelBookingId ? { parcelBookingId } : {}) }
  return [
    { ...base, party: 'RIDER', riderId, type: 'RIDER_SERVICE_FEE', amountMinor: -feeMinor, status: 'DUE', description: `DOORSTEP fee (${percent}%) on ${label}`, dedupeKey: `RIDER_SERVICE_FEE:${source}` },
    { ...base, party: 'PLATFORM', type: 'RIDER_SERVICE_FEE', amountMinor: feeMinor, status: 'RETAINED', description: `${percent}% rider fee on ${label}`, dedupeKey: `RIDER_SERVICE_FEE_INCOME:${source}` },
  ]
}

/** Who is meant to deliver, from the business's delivery preference. "BOTH" defaults to DOORSTEP riders. */
export function plannedFulfilment(deliveryPreference) {
  return deliveryPreference === 'OWN_RIDERS' ? 'BUSINESS_RIDER' : 'DOORSTEP_RIDER'
}

/** Finance settings with a business's negotiated commission (Admin → Money) in place of the platform rates. */
export function withBusinessCommission(settings, restaurant) {
  const doorstep = restaurant?.commissionDoorstepRiderPercent
  const own = restaurant?.commissionOwnRiderPercent
  if (doorstep == null && own == null) return settings
  return { ...settings, commission: { doorstepRiderPercent: doorstep == null ? settings.commission.doorstepRiderPercent : Number(doorstep), ownRiderPercent: own == null ? settings.commission.ownRiderPercent : Number(own) } }
}

/**
 * Splits one paid order between DOORSTEP and the business.
 * - Commission is a percentage of the item subtotal only (never of fees).
 * - DOORSTEP rider: DOORSTEP keeps commission + service fee + delivery fee (it pays the rider).
 * - Business's own rider: lower commission, and the business keeps the delivery fee (it pays its rider).
 */
export function orderShares({ subtotalMinor, deliveryFeeMinor, serviceFeeMinor, totalMinor }, fulfilment, settings) {
  for (const value of [subtotalMinor, deliveryFeeMinor, serviceFeeMinor, totalMinor]) if (!Number.isSafeInteger(value) || value < 0) throw new Error('Order amounts must be whole, non-negative kobo values.')
  if (subtotalMinor + deliveryFeeMinor + serviceFeeMinor !== totalMinor) throw new Error('Order total does not equal subtotal plus fees.')
  const businessRider = fulfilment === 'BUSINESS_RIDER'
  const commissionPercent = businessRider ? settings.commission.ownRiderPercent : settings.commission.doorstepRiderPercent
  const commissionMinor = Math.round(subtotalMinor * commissionPercent / 100)
  const partnerShareMinor = subtotalMinor - commissionMinor + (businessRider ? deliveryFeeMinor : 0)
  const platformShareMinor = totalMinor - partnerShareMinor
  return { fulfilment, commissionPercent, commissionMinor, partnerShareMinor, platformShareMinor, deliveryFeeToPlatformMinor: businessRider ? 0 : deliveryFeeMinor, serviceFeeMinor }
}

/** Rider earning for a delivery distance, from the published Sapele rate bands. Null when it can't be priced honestly. */
export function riderEarning(distanceMeters, settings) {
  const pay = settings.riderPay
  if (!pay?.enabled || !pay.bands?.length) return { amountMinor: null, reason: 'RATES_NOT_PUBLISHED' }
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return { amountMinor: null, reason: 'DISTANCE_UNKNOWN' }
  const km = distanceMeters / 1000
  const bands = [...pay.bands].sort((a, b) => a.upToKm - b.upToKm)
  const match = bands.find((entry) => km <= entry.upToKm)
  if (match) return { amountMinor: match.amountMinor, reason: null, band: match, km }
  const last = bands.at(-1)
  if (!pay.perKmAfterMinor) return { amountMinor: last.amountMinor, reason: null, band: last, km }
  return { amountMinor: last.amountMinor + Math.ceil(km - last.upToKm) * pay.perKmAfterMinor, reason: null, band: last, km, extraKm: Math.ceil(km - last.upToKm) }
}

/** Paystack dynamic split for one order: the business's flat share goes to its subaccount; DOORSTEP keeps the rest. */
export function paystackSplit({ subaccountCode, partnerShareMinor }, settings) {
  if (!settings.split.enabled || !subaccountCode || !(partnerShareMinor > 0)) return null
  return { type: 'flat', bearer_type: settings.split.feeBearer, subaccounts: [{ subaccount: subaccountCode, share: partnerShareMinor }] }
}

/** Ledger rows written when an order is paid. `splitSettled` = Paystack confirmed the business share went to its subaccount. */
export function orderPaidEntries(order, shares, { splitSettled }) {
  const base = { orderId: order.id }
  return [
    { ...base, party: 'PLATFORM', type: 'ORDER_COMMISSION', amountMinor: shares.commissionMinor, status: 'RETAINED', description: `${shares.commissionPercent}% commission on ${order.orderNumber}`, dedupeKey: `ORDER_COMMISSION:${order.id}` },
    { ...base, party: 'PLATFORM', type: 'SERVICE_FEE', amountMinor: shares.serviceFeeMinor, status: 'RETAINED', description: `Service fee on ${order.orderNumber}`, dedupeKey: `SERVICE_FEE:${order.id}` },
    ...(shares.deliveryFeeToPlatformMinor ? [{ ...base, party: 'PLATFORM', type: 'DELIVERY_FEE', amountMinor: shares.deliveryFeeToPlatformMinor, status: 'RETAINED', description: `Delivery fee on ${order.orderNumber}`, dedupeKey: `DELIVERY_FEE:${order.id}` }] : []),
    { ...base, party: 'RESTAURANT', restaurantId: order.restaurantId, type: 'PARTNER_SHARE', amountMinor: shares.partnerShareMinor, status: splitSettled ? 'SETTLED_BY_SPLIT' : 'DUE', description: splitSettled ? `Paid to your bank by Paystack for ${order.orderNumber}` : `Your share of ${order.orderNumber}`, dedupeKey: `PARTNER_SHARE:${order.id}` },
  ].filter((entry) => entry.amountMinor !== 0)
}

/**
 * When the actual deliverer differs from the plan (e.g. a "both" business used its own rider), the business's
 * share is corrected by a ledger adjustment instead of re-splitting a payment that has already settled.
 */
export function fulfilmentAdjustment(order, plannedShares, actualShares) {
  const difference = actualShares.partnerShareMinor - plannedShares.partnerShareMinor
  if (!difference) return null
  return { orderId: order.id, party: 'RESTAURANT', restaurantId: order.restaurantId, type: 'ADJUSTMENT', amountMinor: difference, status: 'DUE', description: difference > 0 ? `Your own rider delivered ${order.orderNumber}: lower commission and the delivery fee are yours` : `A DOORSTEP rider delivered ${order.orderNumber}: standard commission applies`, dedupeKey: `FULFILMENT_ADJUSTMENT:${order.id}` }
}

export const naira = (minor) => `₦${(minor / 100).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`

/** Did Paystack settle the business's share to this subaccount? (charge.success / verify data) */
export function splitSettledTo(verified, subaccountCode) {
  if (!subaccountCode || !verified) return false
  if (verified.subaccountCode === subaccountCode) return true
  try { return JSON.stringify(verified.split || {}).includes(subaccountCode) } catch { return false }
}
