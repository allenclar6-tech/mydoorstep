// Manual / negotiated delivery prices (database side). The rules live in deliveryAssessment.js; this file applies
// them inside transactions so the order, its payment and the quotation always change together.
import { checkOffer, checkResponse, distanceRecord, isExpired, pickupMoved, QuoteError, totalsWithDeliveryFee } from './deliveryAssessment.js'
import { getDeliveryPricing } from './deliveryPricingSettings.js'
import { notifyAdmins, notifyUsers, restaurantTeamIds } from './notify.js'

const naira = (minor) => `₦${(Math.round(minor) / 100).toLocaleString('en-NG')}`
const orderLink = (order) => `/account/orders/${order.id}`

/** Called inside the order-creation transaction when checkout decided the fee needs confirming. */
export async function openDeliveryQuotation(db, order, quote, { customerId }) {
  const delivery = quote.delivery
  const record = distanceRecord(delivery, { pickup: delivery?.pickupPoint || null, dropoff: delivery?.dropoffPoint || null })
  const quotation = await db.deliveryQuotation.create({ data: {
    orderId: order.id,
    status: 'PENDING_REVIEW',
    reasons: quote.manualQuote.reasons,
    estimateFeeMinor: quote.manualQuote.estimateFeeMinor ?? null,
    originalDistance: record,
    pickupSnapshot: delivery?.pickupPoint || null,
    landmark: quote.manualQuote.landmark || null,
    directions: quote.manualQuote.directions || null,
  } })
  await db.deliveryQuotationEvent.create({ data: { quotationId: quotation.id, type: 'REQUESTED', actorId: customerId, actorRole: 'CUSTOMER', message: quote.manualQuote.reasons.join(', ') } })
  await notifyUsers(db, [customerId], { type: 'ORDER', title: 'Your location needs a quick review', body: `We’re confirming the delivery fee for ${order.orderNumber}. You’ll get the price before you pay — nothing is charged yet.`, link: orderLink(order) })
  await notifyAdmins(db, { type: 'ORDER', title: 'Delivery price to confirm', body: `${order.orderNumber}: the customer’s location needs a delivery price before they can pay.`, link: '/admin/delivery-quotes' })
  return quotation
}

/** Admin sends a price, or a revised price. A revision always needs fresh acceptance. */
export async function sendOffer(db, quotationId, admin, input) {
  const pricing = await getDeliveryPricing(db)
  return db.$transaction(async (tx) => {
    const quote = await tx.deliveryQuotation.findUnique({ where: { id: quotationId }, include: { order: { select: { id: true, orderNumber: true, customerId: true, status: true, restaurant: { select: { latitude: true, longitude: true } } } } } })
    if (!quote) throw new QuoteError('QUOTE_NOT_FOUND', 'Request not found.', 404)
    if (quote.order.status !== 'AWAITING_DELIVERY_QUOTE') throw new QuoteError('ORDER_NOT_AWAITING_PRICE', 'This order isn’t waiting for a delivery price any more.')
    const nextStatus = checkOffer(quote, { feeMinor: input.feeMinor, maxQuoteMinor: pricing.manualQuotes?.maxQuoteMinor })
    const version = quote.currentVersion + 1
    const hours = input.expiresInHours ?? pricing.manualQuotes?.expiryHours ?? 24
    const expiresAt = new Date(Date.now() + hours * 3_600_000)
    const previous = quote.currentVersion ? await tx.deliveryQuotationVersion.findUnique({ where: { quotationId_version: { quotationId: quote.id, version: quote.currentVersion } } }) : null
    if (previous && previous.status === 'OFFERED') await tx.deliveryQuotationVersion.update({ where: { id: previous.id }, data: { status: 'SUPERSEDED' } })
    await tx.deliveryQuotationVersion.create({ data: { quotationId: quote.id, version, feeMinor: input.feeMinor, pricingMethod: input.pricingMethod || 'MANUAL_QUOTE', explanation: input.explanation || null, internalNote: input.internalNote || null, expiresAt, proposedById: admin.id, riderPayMinor: input.riderPayMinor ?? null, agreedRiderId: input.agreedRiderId || null } })
    const correction = input.correctedDistanceKm != null ? { correctedDistanceKm: input.correctedDistanceKm, correctionReason: input.correctionReason || null, correctedById: admin.id, correctedAt: new Date() } : {}
    // Guarded update: if the customer answered at the same moment, this offer doesn't silently overwrite it.
    const changed = await tx.deliveryQuotation.updateMany({ where: { id: quote.id, currentVersion: quote.currentVersion, status: quote.status }, data: { status: nextStatus, currentVersion: version, expiresAt, pickupSnapshot: quote.order.restaurant?.latitude != null ? { latitude: Number(quote.order.restaurant.latitude), longitude: Number(quote.order.restaurant.longitude) } : quote.pickupSnapshot, ...correction } })
    if (changed.count !== 1) throw new QuoteError('QUOTE_STATE_CHANGED', 'This request just changed. Refresh and try again.')
    await tx.deliveryQuotationEvent.create({ data: { quotationId: quote.id, type: version === 1 ? 'QUOTE_SENT' : 'QUOTE_REVISED', actorId: admin.id, actorRole: 'ADMIN', fromFeeMinor: previous?.feeMinor ?? null, toFeeMinor: input.feeMinor, version, message: input.explanation || null } })
    if (input.correctedDistanceKm != null) await tx.deliveryQuotationEvent.create({ data: { quotationId: quote.id, type: 'DISTANCE_CORRECTED', actorId: admin.id, actorRole: 'ADMIN', message: `${input.correctedDistanceKm} km${input.correctionReason ? ` — ${input.correctionReason}` : ''}` } })
    await tx.auditLog.create({ data: { actorId: admin.id, action: version === 1 ? 'DELIVERY_QUOTE_SENT' : 'DELIVERY_QUOTE_REVISED', entityType: 'Order', entityId: quote.order.id, metadata: { orderNumber: quote.order.orderNumber, version, fromFeeMinor: previous?.feeMinor ?? null, toFeeMinor: input.feeMinor, pricingMethod: input.pricingMethod || 'MANUAL_QUOTE', correctedDistanceKm: input.correctedDistanceKm ?? null, reason: input.correctionReason || null } } })
    await notifyUsers(tx, [quote.order.customerId], version === 1
      ? { type: 'ORDER', title: 'Your delivery price is ready', body: `Delivery for ${quote.order.orderNumber}: ${naira(input.feeMinor)}. Accept it to pay, or ask us to review it.`, link: orderLink(quote.order) }
      : { type: 'ORDER', title: 'Your revised delivery price is ready', body: `New delivery price for ${quote.order.orderNumber}: ${naira(input.feeMinor)}. Please check and accept it again before paying.`, link: orderLink(quote.order) })
    return { version, status: nextStatus, expiresAt }
  })
}

/** Customer accepts, declines or asks for a review of the current offer. Only the order's own customer can. */
export async function respondToQuote(db, orderId, customer, { action, version, message }) {
  const pricing = await getDeliveryPricing(db)
  const result = await db.$transaction(async (tx) => {
    const order = await tx.order.findFirst({ where: { id: orderId, customerId: customer.id }, include: { payment: true, deliveryQuotation: true, restaurant: { select: { name: true, latitude: true, longitude: true } } } })
    if (!order?.deliveryQuotation) throw new QuoteError('QUOTE_NOT_FOUND', 'There’s no delivery price for this order.', 404)
    const quote = order.deliveryQuotation
    // Expire first, so an old price can never be accepted.
    if (['QUOTE_SENT', 'QUOTE_REVISED'].includes(quote.status) && isExpired(quote)) {
      await expireOne(tx, quote, order)
      throw new QuoteError('QUOTE_EXPIRED', 'This price has expired. DOORSTEP will send you a new one.')
    }
    const nextStatus = checkResponse(quote, { action, version, maxRounds: pricing.manualQuotes?.maxRounds ?? 3 })
    const offer = await tx.deliveryQuotationVersion.findUnique({ where: { quotationId_version: { quotationId: quote.id, version: quote.currentVersion } } })
    if (!offer) throw new QuoteError('QUOTE_NOT_FOUND', 'Price not found.', 404)
    if (action === 'ACCEPT' && pickupMoved(quote.pickupSnapshot, order.restaurant)) {
      await tx.deliveryQuotation.update({ where: { id: quote.id }, data: { status: 'PENDING_REVIEW' } })
      await tx.deliveryQuotationVersion.update({ where: { id: offer.id }, data: { status: 'SUPERSEDED' } })
      await tx.deliveryQuotationEvent.create({ data: { quotationId: quote.id, type: 'PICKUP_CHANGED', actorRole: 'SYSTEM', message: 'The store moved its pickup point after this price was set.' } })
      await notifyAdmins(tx, { type: 'ORDER', title: 'Delivery price needs redoing', body: `${order.orderNumber}: ${order.restaurant.name} moved its pickup point, so the price must be set again.`, link: '/admin/delivery-quotes' })
      return { requote: true }
    }
    const guard = await tx.deliveryQuotation.updateMany({ where: { id: quote.id, status: quote.status, currentVersion: quote.currentVersion }, data: action === 'ACCEPT'
      ? { status: nextStatus, acceptedVersion: offer.version, acceptedFeeMinor: offer.feeMinor }
      : action === 'REVIEW' ? { status: nextStatus, reviewRounds: { increment: 1 } } : { status: nextStatus } })
    if (guard.count !== 1) throw new QuoteError('QUOTE_STATE_CHANGED', 'This price just changed. Please refresh.')
    await tx.deliveryQuotationVersion.update({ where: { id: offer.id }, data: { status: action === 'ACCEPT' ? 'ACCEPTED' : action === 'DECLINE' ? 'DECLINED' : 'REVIEW_REQUESTED', customerResponse: action, customerMessage: message || null, respondedAt: new Date() } })
    await tx.deliveryQuotationEvent.create({ data: { quotationId: quote.id, type: { ACCEPT: 'CUSTOMER_ACCEPTED', DECLINE: 'CUSTOMER_DECLINED', REVIEW: 'CUSTOMER_REVIEW_REQUESTED' }[action], actorId: customer.id, actorRole: 'CUSTOMER', toFeeMinor: offer.feeMinor, version: offer.version, message: message || null } })

    if (action === 'ACCEPT') {
      // The agreed fee becomes the order's delivery fee; the order is now payable (never paid or confirmed here).
      const totals = totalsWithDeliveryFee(order, offer.feeMinor)
      const moved = await tx.order.updateMany({ where: { id: order.id, status: 'AWAITING_DELIVERY_QUOTE' }, data: { ...totals, status: 'PENDING_PAYMENT', deliveryPricingMethod: offer.pricingMethod, ...(offer.riderPayMinor != null ? { plannedRiderPayMinor: offer.riderPayMinor } : {}), ...(offer.agreedRiderId ? { agreedRiderId: offer.agreedRiderId } : {}) } })
      if (moved.count !== 1) throw new QuoteError('ORDER_STATE_CHANGED', 'This order just changed. Please refresh.')
      if (order.payment) {
        const settings = order.payment.method === 'BANK_TRANSFER' ? await tx.platformSetting.findUnique({ where: { key: 'payment_settings' } }).catch(() => null) : null
        const minutes = settings?.value?.bankTransfer?.expiryMinutes
        await tx.payment.update({ where: { id: order.payment.id }, data: { amountMinor: totals.totalMinor, ...(order.payment.method === 'BANK_TRANSFER' ? { status: 'PENDING_VERIFICATION', expiresAt: minutes ? new Date(Date.now() + minutes * 60_000) : null } : {}) } })
        if (order.payment.method === 'BANK_TRANSFER') await notifyAdmins(tx, { type: 'PAYMENT', title: 'Bank transfer to confirm', body: `Order ${order.orderNumber} (${naira(totals.totalMinor)}) will be paid by bank transfer, reference ${order.payment.reference}. Confirm it once the money arrives.`, link: '/admin/payments' })
      }
      await tx.auditLog.create({ data: { actorId: customer.id, action: 'DELIVERY_QUOTE_ACCEPTED', entityType: 'Order', entityId: order.id, metadata: { orderNumber: order.orderNumber, version: offer.version, feeMinor: offer.feeMinor, totalMinor: totals.totalMinor } } })
      await notifyUsers(tx, [customer.id], { type: 'ORDER', title: 'Delivery price confirmed', body: `${order.orderNumber}: delivery ${naira(offer.feeMinor)}, total ${naira(totals.totalMinor)}. You can pay now.`, link: orderLink(order) })
      await notifyUsers(tx, await restaurantTeamIds(tx, order.restaurantId), { type: 'ORDER', title: 'Delivery price confirmed', body: `${order.orderNumber}: the customer accepted a delivery fee of ${naira(offer.feeMinor)}. The order reaches you once it’s paid.`, link: '/restaurant/orders' })
    } else if (action === 'DECLINE') {
      await tx.order.updateMany({ where: { id: order.id, status: 'AWAITING_DELIVERY_QUOTE' }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: 'Customer declined the delivery price' } })
      if (order.payment && ['PENDING', 'PENDING_VERIFICATION'].includes(order.payment.status)) await tx.payment.update({ where: { id: order.payment.id }, data: { status: 'ABANDONED' } })
      await notifyUsers(tx, [customer.id], { type: 'ORDER', title: 'Order cancelled', body: `You declined the delivery price for ${order.orderNumber}, so the order is cancelled. You weren’t charged.`, link: orderLink(order) })
      await notifyAdmins(tx, { type: 'ORDER', title: 'Delivery price declined', body: `${order.orderNumber}: the customer declined ${naira(offer.feeMinor)}.`, link: '/admin/delivery-quotes' })
    } else {
      await notifyAdmins(tx, { type: 'ORDER', title: 'Customer asked for a better delivery price', body: `${order.orderNumber}: ${naira(offer.feeMinor)} — “${(message || 'No message').slice(0, 140)}”`, link: '/admin/delivery-quotes' })
    }
    return { status: nextStatus }
  })
  return result
}

/** Admin cancels the request (the order is cancelled; nothing was paid). */
export async function cancelQuote(db, quotationId, admin, reason) {
  return db.$transaction(async (tx) => {
    const quote = await tx.deliveryQuotation.findUnique({ where: { id: quotationId }, include: { order: { include: { payment: true } } } })
    if (!quote) throw new QuoteError('QUOTE_NOT_FOUND', 'Request not found.', 404)
    if (!['PENDING_REVIEW', 'QUOTE_SENT', 'CUSTOMER_REVIEW_REQUESTED', 'QUOTE_REVISED', 'QUOTE_EXPIRED'].includes(quote.status)) throw new QuoteError('QUOTE_CLOSED', 'This request is already closed.')
    const guard = await tx.deliveryQuotation.updateMany({ where: { id: quote.id, status: quote.status }, data: { status: 'QUOTE_CANCELLED' } })
    if (guard.count !== 1) throw new QuoteError('QUOTE_STATE_CHANGED', 'This request just changed. Refresh and try again.')
    await tx.deliveryQuotationVersion.updateMany({ where: { quotationId: quote.id, status: 'OFFERED' }, data: { status: 'CANCELLED' } })
    await tx.order.updateMany({ where: { id: quote.orderId, status: 'AWAITING_DELIVERY_QUOTE' }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: `DOORSTEP couldn’t deliver here: ${reason}` } })
    if (quote.order.payment && ['PENDING', 'PENDING_VERIFICATION'].includes(quote.order.payment.status)) await tx.payment.update({ where: { id: quote.order.payment.id }, data: { status: 'ABANDONED' } })
    await tx.deliveryQuotationEvent.create({ data: { quotationId: quote.id, type: 'CANCELLED', actorId: admin.id, actorRole: 'ADMIN', message: reason } })
    await tx.auditLog.create({ data: { actorId: admin.id, action: 'DELIVERY_QUOTE_CANCELLED', entityType: 'Order', entityId: quote.orderId, metadata: { orderNumber: quote.order.orderNumber, reason } } })
    await notifyUsers(tx, [quote.order.customerId], { type: 'ORDER', title: 'Order cancelled', body: `Sorry — we can’t deliver ${quote.order.orderNumber} to this address: ${reason} You weren’t charged.`, link: orderLink(quote.order) })
    return { status: 'QUOTE_CANCELLED' }
  })
}

/** Admin answers a review request without changing the price (the same offer goes back to the customer). */
export async function keepPrice(db, quotationId, admin, message) {
  return db.$transaction(async (tx) => {
    const quote = await tx.deliveryQuotation.findUnique({ where: { id: quotationId }, include: { order: { select: { id: true, orderNumber: true, customerId: true } } } })
    if (!quote || quote.status !== 'CUSTOMER_REVIEW_REQUESTED') throw new QuoteError('NO_REVIEW_REQUEST', 'There’s no review request to answer.')
    const offer = await tx.deliveryQuotationVersion.findUnique({ where: { quotationId_version: { quotationId: quote.id, version: quote.currentVersion } } })
    const back = isExpired(quote) ? null : 'QUOTE_SENT'
    if (!back) throw new QuoteError('QUOTE_EXPIRED', 'This price has expired. Send a new price instead.')
    await tx.deliveryQuotation.update({ where: { id: quote.id }, data: { status: back } })
    await tx.deliveryQuotationVersion.update({ where: { id: offer.id }, data: { status: 'OFFERED' } })
    await tx.deliveryQuotationEvent.create({ data: { quotationId: quote.id, type: 'REVIEW_DECLINED', actorId: admin.id, actorRole: 'ADMIN', toFeeMinor: offer.feeMinor, version: offer.version, message } })
    await notifyUsers(tx, [quote.order.customerId], { type: 'ORDER', title: 'About your delivery price', body: `${quote.order.orderNumber}: we’ve kept the delivery price at ${naira(offer.feeMinor)}. ${message}`.slice(0, 300), link: orderLink(quote.order) })
    return { status: back }
  })
}

/** The customer cancelled or removed an order that was waiting for its price: close the request too. */
export async function closeQuotation(tx, orderId, actorId, reason) {
  const quote = await tx.deliveryQuotation.findUnique({ where: { orderId } })
  if (!quote || !['PENDING_REVIEW', 'QUOTE_SENT', 'CUSTOMER_REVIEW_REQUESTED', 'QUOTE_REVISED', 'QUOTE_EXPIRED'].includes(quote.status)) return false
  await tx.deliveryQuotation.update({ where: { id: quote.id }, data: { status: 'QUOTE_CANCELLED' } })
  await tx.deliveryQuotationVersion.updateMany({ where: { quotationId: quote.id, status: 'OFFERED' }, data: { status: 'CANCELLED' } })
  await tx.deliveryQuotationEvent.create({ data: { quotationId: quote.id, type: 'CANCELLED', actorId, actorRole: 'CUSTOMER', message: reason } })
  return true
}

async function expireOne(tx, quote, order) {
  const changed = await tx.deliveryQuotation.updateMany({ where: { id: quote.id, status: quote.status }, data: { status: 'QUOTE_EXPIRED' } })
  if (changed.count !== 1) return false
  await tx.deliveryQuotationVersion.updateMany({ where: { quotationId: quote.id, version: quote.currentVersion, status: 'OFFERED' }, data: { status: 'EXPIRED' } })
  await tx.deliveryQuotationEvent.create({ data: { quotationId: quote.id, type: 'EXPIRED', actorRole: 'SYSTEM' } })
  await notifyUsers(tx, [order.customerId], { type: 'ORDER', title: 'Your delivery price expired', body: `The delivery price for ${order.orderNumber} expired before it was accepted. We’ll send you a new one.`, link: orderLink(order) })
  await notifyAdmins(tx, { type: 'ORDER', title: 'Delivery price expired', body: `${order.orderNumber}: the customer didn’t answer in time. Send a new price or cancel.`, link: '/admin/delivery-quotes' })
  return true
}

/** Background sweep: expires unanswered prices (run every few minutes). */
export async function expireQuotes(db, now = new Date()) {
  const due = await db.deliveryQuotation.findMany({ where: { status: { in: ['QUOTE_SENT', 'QUOTE_REVISED'] }, expiresAt: { lte: now } }, include: { order: { select: { id: true, orderNumber: true, customerId: true } } }, take: 100 })
  let count = 0
  for (const quote of due) if (await db.$transaction((tx) => expireOne(tx, quote, quote.order))) count += 1
  return count
}
