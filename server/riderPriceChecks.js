import { notifyAdmins, notifyUsers } from './notify.js'
import { QuoteError } from './deliveryAssessment.js'

// Price checks: delivery prices for places that couldn't be measured are fixed between DOORSTEP admins and riders.
// Customers never negotiate — they only accept or decline the final price. Businesses aren't involved.
//
// 1. An admin asks riders (with an optional suggested rider pay).
// 2. Riders answer: "OK at ₦X" (AGREE), "I'd do it for ₦Y" (COUNTER) or "Not for me" (DECLINE), with a short reason.
// 3. The admin chooses the rider pay (and optionally the rider who agreed), then sends the customer price.
//    When the customer accepts, that rider pay is fixed on the order and the agreeing rider is offered the job first.

export const ASK_OPEN_HOURS = 48
export const MAX_RIDERS_ASKED = 20
const ASKABLE_ORDER_STATUS = 'AWAITING_DELIVERY_QUOTE'
const naira = (minor) => `₦${Math.round(Number(minor || 0) / 100).toLocaleString('en-NG')}`
const dist2 = (a, b) => (Number(a.latitude) - Number(b.latitude)) ** 2 + (Number(a.longitude) - Number(b.longitude)) ** 2

/** Approved DOORSTEP riders to ask: online ones first, nearest to the store first; then recently active offline ones. */
export function pickRidersToAsk(riders, store, limit = MAX_RIDERS_ASKED) {
  const located = (rider) => rider.availabilityLatitude != null && rider.availabilityLongitude != null
  const storePoint = store?.latitude != null && store?.longitude != null ? store : null
  return [...riders]
    .filter((rider) => rider.status === 'APPROVED' && rider.network === 'DOORSTEP_POOL')
    .sort((a, b) => {
      if ((a.availability === 'ONLINE') !== (b.availability === 'ONLINE')) return a.availability === 'ONLINE' ? -1 : 1
      if (storePoint && located(a) !== located(b)) return located(a) ? -1 : 1
      if (storePoint && located(a) && located(b)) return dist2({ latitude: a.availabilityLatitude, longitude: a.availabilityLongitude }, storePoint) - dist2({ latitude: b.availabilityLatitude, longitude: b.availabilityLongitude }, storePoint)
      return new Date(b.availabilityChangedAt || 0) - new Date(a.availabilityChangedAt || 0)
    })
    .slice(0, limit)
}

/** Whether riders can still answer this check. */
export function checkIsOpen(quote, orderStatus, now = new Date()) {
  return Boolean(quote?.riderAskAt) && orderStatus === ASKABLE_ORDER_STATUS && now - new Date(quote.riderAskAt) < ASK_OPEN_HOURS * 3_600_000
}

/** Admin asks riders. Returns how many were asked. */
export async function askRiders(db, quotationId, admin, { suggestedPayMinor = null, note = null } = {}) {
  const quote = await db.deliveryQuotation.findUnique({ where: { id: quotationId }, include: { order: { select: { id: true, orderNumber: true, status: true, restaurant: { select: { name: true, latitude: true, longitude: true } } } } } })
  if (!quote) throw new QuoteError('QUOTE_NOT_FOUND', 'Request not found.', 404)
  if (quote.order.status !== ASKABLE_ORDER_STATUS) throw new QuoteError('ORDER_NOT_AWAITING_PRICE', 'This order isn’t waiting for a delivery price any more.')
  const riders = await db.rider.findMany({ where: { status: 'APPROVED', network: 'DOORSTEP_POOL' }, select: { id: true, userId: true, status: true, network: true, availability: true, availabilityLatitude: true, availabilityLongitude: true, availabilityChangedAt: true }, take: 500 })
  const chosen = pickRidersToAsk(riders, quote.order.restaurant)
  if (!chosen.length) throw new QuoteError('NO_RIDERS', 'There are no approved DOORSTEP riders to ask yet.')
  await db.deliveryQuotation.update({ where: { id: quote.id }, data: { riderAskAt: new Date(), riderAskPayMinor: suggestedPayMinor, riderAskNote: note } })
  await db.deliveryQuotationEvent.create({ data: { quotationId: quote.id, type: 'RIDERS_ASKED', actorId: admin.id, actorRole: 'ADMIN', toFeeMinor: suggestedPayMinor, message: `${chosen.length} rider${chosen.length === 1 ? '' : 's'} asked${note ? `: ${note}` : ''}` } })
  await db.auditLog.create({ data: { actorId: admin.id, action: 'RIDER_PRICE_CHECK_SENT', entityType: 'Order', entityId: quote.order.id, metadata: { orderNumber: quote.order.orderNumber, riders: chosen.length, suggestedPayMinor } } })
  await notifyUsers(db, chosen.map((rider) => rider.userId), { type: 'DELIVERY', title: 'Price check: what should this trip pay?', body: `${quote.order.restaurant.name} → ${quote.order.orderNumber}${suggestedPayMinor != null ? `. DOORSTEP suggests ${naira(suggestedPayMinor)} for you` : ''}. Tell us your price.`, link: '/rider/price-checks' })
  return { asked: chosen.length }
}

/** Open checks a rider can answer (no customer name, phone or exact address — just areas and landmarks). */
export async function openChecksForRider(db, rider, now = new Date()) {
  if (!rider || rider.status !== 'APPROVED' || rider.network !== 'DOORSTEP_POOL') return []
  const quotes = await db.deliveryQuotation.findMany({
    where: { riderAskAt: { gte: new Date(now.getTime() - ASK_OPEN_HOURS * 3_600_000) }, order: { status: ASKABLE_ORDER_STATUS } },
    orderBy: { riderAskAt: 'desc' }, take: 30,
    include: { order: { select: { orderNumber: true, status: true, deliveryQuote: true, restaurant: { select: { name: true, address: true } } } }, riderPrices: { where: { riderId: rider.id } } },
  })
  return quotes.filter((quote) => checkIsOpen(quote, quote.order.status, now)).map((quote) => {
    const original = quote.originalDistance || {}
    const km = quote.correctedDistanceKm != null ? Number(quote.correctedDistanceKm) : original.km ?? null
    const mine = quote.riderPrices[0] || null
    return {
      id: quote.id, orderNumber: quote.order.orderNumber, askedAt: quote.riderAskAt,
      store: { name: quote.order.restaurant.name, address: quote.order.restaurant.address },
      dropoffArea: quote.order.deliveryQuote?.dropoffZone?.name || null,
      landmark: quote.landmark || null,
      km, kmMeasured: quote.correctedDistanceKm != null || (original.km != null && original.verificationStatus !== 'UNAVAILABLE_DISTANCE'),
      suggestedPayMinor: quote.riderAskPayMinor, note: quote.riderAskNote,
      myAnswer: mine && { response: mine.response, amountMinor: mine.amountMinor, note: mine.note, at: mine.updatedAt },
    }
  })
}

/** A rider answers a check (can change their answer while it's open). */
export async function answerCheck(db, rider, quotationId, { response, amountMinor = null, note = null }, now = new Date()) {
  if (!rider || rider.status !== 'APPROVED' || rider.network !== 'DOORSTEP_POOL') throw new QuoteError('NOT_A_DOORSTEP_RIDER', 'Only approved DOORSTEP riders can answer price checks.', 403)
  if (!['AGREE', 'COUNTER', 'DECLINE'].includes(response)) throw new QuoteError('INVALID_ANSWER', 'Choose an answer.', 400)
  const quote = await db.deliveryQuotation.findUnique({ where: { id: quotationId }, include: { order: { select: { orderNumber: true, status: true } } } })
  if (!quote || !checkIsOpen(quote, quote.order.status, now)) throw new QuoteError('CHECK_CLOSED', 'This price check has closed.', 409)
  const amount = response === 'AGREE' ? quote.riderAskPayMinor : response === 'COUNTER' ? amountMinor : null
  if (response === 'AGREE' && amount == null) throw new QuoteError('NO_SUGGESTED_PRICE', 'DOORSTEP didn’t suggest a price for this one — type the price you’d do it for.', 400)
  if (response === 'COUNTER' && !(Number.isInteger(amount) && amount >= 10_000 && amount <= 5_000_000)) throw new QuoteError('INVALID_AMOUNT', 'Type your price in naira (between ₦100 and ₦50,000).', 400)
  const cleanNote = note ? String(note).replace(/\s+/g, ' ').trim().slice(0, 200) || null : null
  const saved = await db.riderPriceSuggestion.upsert({
    where: { quotationId_riderId: { quotationId, riderId: rider.id } },
    update: { response, amountMinor: amount, note: cleanNote },
    create: { quotationId, riderId: rider.id, response, amountMinor: amount, note: cleanNote },
  })
  await db.deliveryQuotationEvent.create({ data: { quotationId, type: 'RIDER_PRICE', actorId: rider.userId, actorRole: 'RIDER', toFeeMinor: amount, message: `${response === 'AGREE' ? 'Agreed' : response === 'COUNTER' ? 'Suggested' : 'Not for them'}${cleanNote ? `: ${cleanNote}` : ''}` } })
  if (response !== 'DECLINE') await notifyAdmins(db, { type: 'DELIVERY', title: `Rider price for ${quote.order.orderNumber}`, body: `${response === 'AGREE' ? 'A rider agreed' : 'A rider suggested'} ${naira(amount)}${cleanNote ? ` — “${cleanNote}”` : ''}.`, link: `/admin/delivery-quotes?id=${quotationId}` })
  return saved
}

/** Answers for the admin, with rider names, ratings and phones (admins can call riders to discuss). */
export async function riderPricesFor(db, quotationId) {
  const rows = await db.riderPriceSuggestion.findMany({ where: { quotationId }, orderBy: { updatedAt: 'desc' } })
  const riders = rows.length ? await db.rider.findMany({ where: { id: { in: rows.map((row) => row.riderId) } }, select: { id: true, ratingAverage: true, ratingCount: true, vehicleType: true, user: { select: { firstName: true, lastName: true, phone: true } } } }) : []
  const byId = new Map(riders.map((rider) => [rider.id, rider]))
  return rows.map((row) => {
    const rider = byId.get(row.riderId)
    return { riderId: row.riderId, name: rider ? `${rider.user.firstName || ''} ${rider.user.lastName || ''}`.trim() || 'Rider' : 'Rider', phone: rider?.user.phone || null, rating: rider?.ratingCount ? Number(rider.ratingAverage) : null, trips: rider?.ratingCount || 0, vehicle: rider?.vehicleType || null, response: row.response, amountMinor: row.amountMinor, note: row.note, at: row.updatedAt }
  })
}

/** Validates the admin's chosen rider pay / agreeing rider when sending the customer price. */
export async function checkRiderChoice(db, quotationId, { riderPayMinor, agreedRiderId }) {
  if (riderPayMinor != null && !(Number.isInteger(riderPayMinor) && riderPayMinor >= 0 && riderPayMinor <= 5_000_000)) throw new QuoteError('INVALID_RIDER_PAY', 'Type the rider’s pay in naira.', 400)
  if (!agreedRiderId) return
  const answer = await db.riderPriceSuggestion.findUnique({ where: { quotationId_riderId: { quotationId, riderId: agreedRiderId } } })
  if (!answer || answer.response === 'DECLINE') throw new QuoteError('RIDER_DIDNT_AGREE', 'That rider hasn’t agreed a price for this order.', 400)
  if (riderPayMinor == null || riderPayMinor < answer.amountMinor) throw new QuoteError('RIDER_PAY_BELOW_AGREED', `This rider agreed ${naira(answer.amountMinor)}. Their pay can’t be lower than that.`, 400)
}
