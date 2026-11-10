// Delivery overview and rider performance for admins, built from orders, deliveries, quotes, dispatch offers and the
// ledger (nothing stored twice). Money: delivery income = delivery fees + business delivery contributions − delivery
// paid by DOORSTEP; rider pay = rider earnings + tips are excluded (tips are the customer's money for the rider).

const ACTIVE = ['ACCEPTED', 'GOING_TO_RESTAURANT', 'ARRIVED_AT_RESTAURANT', 'PICKED_UP', 'GOING_TO_CUSTOMER']
const OPEN_QUOTES = ['PENDING_REVIEW', 'CUSTOMER_REVIEW_REQUESTED', 'QUOTE_EXPIRED']
const WITH_CUSTOMER = ['QUOTE_SENT', 'QUOTE_REVISED']
const lagosDay = (date) => new Date(new Date(date).getTime() + 3_600_000).toISOString().slice(0, 10)

/** One bucket per Lagos day (or per week when the range is long), so charts are always continuous. */
export function buckets(from, to) {
  const days = Math.max(1, Math.round((to - from) / 86_400_000))
  const size = days > 62 ? 7 : 1
  const list = []
  for (let start = from.getTime(); start < to.getTime(); start += size * 86_400_000) list.push({ key: lagosDay(start), from: new Date(start), to: new Date(Math.min(start + size * 86_400_000, to.getTime())), delivered: 0, failed: 0, incomeMinor: 0, riderPayMinor: 0 })
  return { size, list }
}
const bucketFor = (list, date) => list.find((bucket) => date >= bucket.from && date < bucket.to)

export function summarise({ delivered, failed, ledger, from, to }) {
  const { size, list } = buckets(from, to)
  for (const row of delivered) { const bucket = bucketFor(list, new Date(row.deliveredAt)); if (bucket) bucket.delivered += 1 }
  for (const row of failed) { const bucket = bucketFor(list, new Date(row.failedAt)); if (bucket) bucket.failed += 1 }
  let incomeMinor = 0
  let riderPayMinor = 0
  for (const entry of ledger) {
    const bucket = bucketFor(list, new Date(entry.createdAt))
    if (entry.party === 'PLATFORM' && ['DELIVERY_FEE', 'DELIVERY_CONTRIBUTION', 'DELIVERY_SUBSIDY'].includes(entry.type)) { incomeMinor += entry.amountMinor; if (bucket) bucket.incomeMinor += entry.amountMinor }
    if (entry.party === 'RIDER' && ['RIDER_EARNING', 'WAITING_PAY'].includes(entry.type)) { riderPayMinor += entry.amountMinor; if (bucket) bucket.riderPayMinor += entry.amountMinor }
  }
  const fees = delivered.map((row) => row.deliveryFeeMinor).filter((value) => Number.isFinite(value))
  return {
    bucketDays: size,
    series: list.map(({ key, delivered: count, failed: lost, incomeMinor: income, riderPayMinor: pay }) => ({ day: key, delivered: count, failed: lost, incomeMinor: income, riderPayMinor: pay, marginMinor: income - pay })),
    totals: { delivered: delivered.length, failed: failed.length, incomeMinor, riderPayMinor, marginMinor: incomeMinor - riderPayMinor, averageFeeMinor: fees.length ? Math.round(fees.reduce((sum, value) => sum + value, 0) / fees.length) : 0 },
  }
}

export async function deliveryOverview(db, { from, to }) {
  const range = { gte: from, lt: to }
  const [delivered, failed, ledger, active, waiting, quotesOpen, quotesWithCustomer, quotesAccepted, roadReports, locationReviews] = await Promise.all([
    db.order.findMany({ where: { deliveredAt: range, orderType: 'DELIVERY' }, select: { deliveredAt: true, deliveryFeeMinor: true } }),
    db.delivery.findMany({ where: { failedAt: range }, select: { failedAt: true } }),
    db.ledgerEntry.findMany({ where: { createdAt: range, status: { not: 'VOID' }, OR: [{ party: 'PLATFORM', type: { in: ['DELIVERY_FEE', 'DELIVERY_CONTRIBUTION', 'DELIVERY_SUBSIDY'] } }, { party: 'RIDER', type: { in: ['RIDER_EARNING', 'WAITING_PAY'] } }] }, select: { party: true, type: true, amountMinor: true, createdAt: true } }),
    db.delivery.count({ where: { status: { in: ACTIVE } } }),
    db.delivery.count({ where: { riderId: null, orderId: { not: null }, status: { in: ['AVAILABLE', 'REQUESTED'] }, order: { status: { in: ['RESTAURANT_ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP'] } } } }),
    db.deliveryQuotation.count({ where: { status: { in: OPEN_QUOTES } } }),
    db.deliveryQuotation.count({ where: { status: { in: WITH_CUSTOMER } } }),
    db.deliveryQuotation.count({ where: { status: 'QUOTE_ACCEPTED', updatedAt: range } }),
    db.roadReport ? db.roadReport.count({ where: { status: 'PENDING' } }) : 0,
    db.locationReview ? db.locationReview.count({ where: { status: 'SUBMITTED' } }).catch(() => 0) : 0,
  ])
  return { now: { active, unassigned: waiting, quotesToPrice: quotesOpen, quotesWithCustomer, awaitingRouteCheck: (roadReports || 0) + (locationReviews || 0) }, quotesAccepted, ...summarise({ delivered, failed, ledger, from, to }) }
}

/** Per-rider performance in a period. Acceptance rate = accepted ÷ (accepted + declined + let expire). */
export function riderStats({ offers, deliveries, earnings }) {
  const by = new Map()
  const row = (id) => { if (!by.has(id)) by.set(id, { riderId: id, offers: 0, accepted: 0, declined: 0, expired: 0, delivered: 0, failed: 0, minutes: [], earnedMinor: 0 }); return by.get(id) }
  for (const offer of offers) { const r = row(offer.riderId); r.offers += 1; if (offer.status === 'ACCEPTED') r.accepted += 1; if (offer.status === 'DECLINED') r.declined += 1; if (offer.status === 'EXPIRED') r.expired += 1 }
  for (const delivery of deliveries) {
    if (!delivery.riderId) continue
    const r = row(delivery.riderId)
    if (delivery.failedAt) r.failed += 1
    else if (delivery.deliveredAt) { r.delivered += 1; if (delivery.acceptedAt) r.minutes.push((new Date(delivery.deliveredAt) - new Date(delivery.acceptedAt)) / 60_000) }
  }
  for (const entry of earnings) row(entry.riderId).earnedMinor += entry.amountMinor
  return [...by.values()].map(({ minutes, ...r }) => {
    const answered = r.accepted + r.declined + r.expired
    return { ...r, acceptanceRate: answered ? Math.round(r.accepted / answered * 100) : null, averageMinutes: minutes.length ? Math.round(minutes.reduce((sum, value) => sum + value, 0) / minutes.length) : null }
  })
}

export async function riderPerformance(db, { from, to }) {
  const range = { gte: from, lt: to }
  const [offers, deliveries, earnings] = await Promise.all([
    db.dispatchOffer.findMany({ where: { offeredAt: range }, select: { riderId: true, status: true } }),
    db.delivery.findMany({ where: { OR: [{ deliveredAt: range }, { failedAt: range }], riderId: { not: null } }, select: { riderId: true, acceptedAt: true, deliveredAt: true, failedAt: true } }),
    db.ledgerEntry.findMany({ where: { party: 'RIDER', type: { in: ['RIDER_EARNING', 'TIP'] }, status: { notIn: ['VOID', 'NEEDS_REVIEW'] }, createdAt: range }, select: { riderId: true, amountMinor: true } }),
  ])
  const stats = riderStats({ offers, deliveries, earnings })
  const riders = stats.length ? await db.rider.findMany({ where: { id: { in: stats.map((row) => row.riderId) } }, select: { id: true, vehicleType: true, ratingAverage: true, ratingCount: true, availability: true, user: { select: { firstName: true, lastName: true } } } }) : []
  const info = new Map(riders.map((rider) => [rider.id, rider]))
  return stats.map((row) => { const rider = info.get(row.riderId); return { ...row, name: rider ? `${rider.user.firstName || ''} ${rider.user.lastName || ''}`.trim() || 'Rider' : 'Rider', vehicle: rider?.vehicleType || null, rating: rider?.ratingCount ? Number(rider.ratingAverage) : null, online: rider?.availability === 'ONLINE' } }).sort((a, b) => b.delivered - a.delivered)
}
