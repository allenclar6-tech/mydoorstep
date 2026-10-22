import { fulfilmentAdjustment, naira, orderPaidEntries, orderShares, riderEarning, splitSettledTo, withBusinessCommission } from './financeService.js'
import { getFinanceSettings } from './financeSettings.js'

// Database side of the money rules. All writes are idempotent (LedgerEntry.dedupeKey is unique), so a webhook
// and the callback page confirming the same payment can never double-count.

async function writeEntries(db, entries) {
  if (!entries.length) return 0
  const result = await db.ledgerEntry.createMany({ data: entries, skipDuplicates: true })
  return result.count
}

/** Shares fixed when the order was created (so later rate changes never rewrite history). */
export function plannedOrderShares(order, settings) {
  if (order.commissionPercent != null && order.partnerShareMinor != null) {
    const commissionPercent = Number(order.commissionPercent)
    const commissionMinor = Math.round(order.subtotalMinor * commissionPercent / 100)
    const businessRider = order.fulfilment === 'BUSINESS_RIDER'
    return { fulfilment: order.fulfilment, commissionPercent, commissionMinor, partnerShareMinor: order.partnerShareMinor, platformShareMinor: order.totalMinor - order.partnerShareMinor, deliveryFeeToPlatformMinor: businessRider ? 0 : order.deliveryFeeMinor, serviceFeeMinor: order.serviceFeeMinor }
  }
  return orderShares(order, order.fulfilment || 'DOORSTEP_RIDER', settings)
}

/** Called inside the payment-confirmation transaction for a food/grocery order. */
export async function recordOrderPaid(db, order, { splitSettled = false } = {}) {
  const settings = await getFinanceSettings(db)
  const shares = plannedOrderShares(order, settings)
  await db.commission.upsert({ where: { orderId: order.id }, update: {}, create: { orderId: order.id, percentage: shares.commissionPercent, amountMinor: shares.commissionMinor } })
  await db.restaurantPayout.upsert({ where: { orderId: order.id }, update: {}, create: { restaurantId: order.restaurantId, orderId: order.id, amountMinor: shares.partnerShareMinor, status: splitSettled ? 'PAID' : 'PENDING', paidAt: splitSettled ? new Date() : null } })
  await writeEntries(db, orderPaidEntries(order, shares, { splitSettled }))
  return shares
}

export async function recordParcelPaid(db, booking) {
  await writeEntries(db, [{ parcelBookingId: booking.id, party: 'PLATFORM', type: 'PARCEL_REVENUE', amountMinor: booking.totalMinor, status: 'RETAINED', description: `Package delivery ${booking.reference}`, dedupeKey: `PARCEL_REVENUE:${booking.id}` }])
}

/**
 * Called when a delivery is marked DELIVERED. Records the DOORSTEP rider's earning from the published Sapele
 * distance rates (business-owned riders are paid by their business), and corrects the business's share if the
 * deliverer differed from the plan. Returns the rider entry (or null).
 */
export async function recordDeliveryCompleted(db, deliveryId) {
  const delivery = await db.delivery.findUnique({ where: { id: deliveryId }, include: { rider: { select: { id: true, network: true, restaurantId: true, userId: true } }, order: true, parcelBooking: true } })
  if (!delivery?.rider) return null
  const settings = await getFinanceSettings(db)
  const businessRider = delivery.rider.network === 'BUSINESS_OWNED'
  const entries = []
  let riderEntry = null

  if (delivery.order) {
    const order = delivery.order
    const planned = plannedOrderShares(order, settings)
    const actualFulfilment = businessRider ? 'BUSINESS_RIDER' : 'DOORSTEP_RIDER'
    if (actualFulfilment !== planned.fulfilment) {
      const restaurant = await db.restaurant.findUnique({ where: { id: order.restaurantId }, select: { commissionDoorstepRiderPercent: true, commissionOwnRiderPercent: true } })
      const actual = orderShares(order, actualFulfilment, withBusinessCommission(settings, restaurant))
      const adjustment = fulfilmentAdjustment(order, planned, actual)
      if (adjustment) entries.push(adjustment)
      if (actualFulfilment === 'BUSINESS_RIDER' && planned.deliveryFeeToPlatformMinor) entries.push({ orderId: order.id, party: 'PLATFORM', type: 'DELIVERY_FEE', amountMinor: -planned.deliveryFeeToPlatformMinor, status: 'RETAINED', description: `Delivery fee passed to the business for ${order.orderNumber}`, dedupeKey: `DELIVERY_FEE_REVERSAL:${order.id}` })
    }
    if (!businessRider) {
      // Rider pay fixed at checkout (distance rate card, area bonus, agreed route price or busy-time boost) wins;
      // older orders fall back to the rate card for the measured distance.
      const earning = order.plannedRiderPayMinor != null ? { amountMinor: order.plannedRiderPayMinor } : riderEarning(order.deliveryDistanceMeters, settings)
      riderEntry = { orderId: order.id, party: 'RIDER', riderId: delivery.rider.id, type: 'RIDER_EARNING', amountMinor: earning.amountMinor ?? 0, status: earning.amountMinor == null ? 'NEEDS_REVIEW' : 'DUE', description: earning.amountMinor == null ? `${order.orderNumber}: ${earning.reason === 'DISTANCE_UNKNOWN' ? 'distance unknown' : 'rider rates not published'} — DOORSTEP will set this amount` : `${order.orderNumber} · ${(order.deliveryDistanceMeters / 1000).toFixed(1)} km`, dedupeKey: `RIDER_EARNING:order:${order.id}` }
      if (earning.amountMinor != null) await db.riderPayout.upsert({ where: { orderId: order.id }, update: {}, create: { riderId: delivery.rider.id, orderId: order.id, amountMinor: earning.amountMinor } })
    }
  } else if (delivery.parcelBooking && !businessRider) {
    const booking = delivery.parcelBooking
    const earning = riderEarning(booking.distanceMeters, settings)
    riderEntry = { parcelBookingId: booking.id, party: 'RIDER', riderId: delivery.rider.id, type: 'RIDER_EARNING', amountMinor: earning.amountMinor ?? 0, status: earning.amountMinor == null ? 'NEEDS_REVIEW' : 'DUE', description: earning.amountMinor == null ? `${booking.reference}: rider rates not published — DOORSTEP will set this amount` : `${booking.reference} · ${(booking.distanceMeters / 1000).toFixed(1)} km`, dedupeKey: `RIDER_EARNING:parcel:${booking.id}` }
  }
  if (riderEntry) entries.push(riderEntry)
  await writeEntries(db, entries)
  return riderEntry
}

/** Money each party is owed right now (DUE entries, including negative adjustments). */
export async function balancesDue(db, { party, restaurantId, riderId } = {}) {
  const rows = await db.ledgerEntry.groupBy({ by: ['party', 'restaurantId', 'riderId'], where: { status: 'DUE', party: party || { in: ['RESTAURANT', 'RIDER'] }, ...(restaurantId ? { restaurantId } : {}), ...(riderId ? { riderId } : {}) }, _sum: { amountMinor: true }, _count: { _all: true } })
  return rows.map((row) => ({ party: row.party, restaurantId: row.restaurantId, riderId: row.riderId, amountMinor: row._sum.amountMinor || 0, entries: row._count._all }))
}

export { naira, splitSettledTo }

/**
 * Undoes an order's money records when it is cancelled after payment. DOORSTEP income is voided; a business
 * share that Paystack already settled to the business is recorded as owed back (deducted from future earnings).
 */
export async function voidOrderMoney(db, order, reason) {
  await db.ledgerEntry.updateMany({ where: { orderId: order.id, status: { in: ['RETAINED', 'DUE', 'NEEDS_REVIEW'] } }, data: { status: 'VOID' } })
  const settled = await db.ledgerEntry.findFirst({ where: { orderId: order.id, type: 'PARTNER_SHARE', status: 'SETTLED_BY_SPLIT' } })
  if (settled) {
    await writeEntries(db, [{ orderId: order.id, party: 'RESTAURANT', restaurantId: order.restaurantId, type: 'ADJUSTMENT', amountMinor: -settled.amountMinor, status: 'DUE', description: `${order.orderNumber} was cancelled and refunded (${reason}); your share is returned to the customer`, dedupeKey: `CANCEL_CLAWBACK:${order.id}` }])
  }
  await db.restaurantPayout.updateMany({ where: { orderId: order.id, status: 'PENDING' }, data: { status: 'FAILED' } })
}
