import { riderFeeEntries } from './financeService.js'
import { getFinanceSettings } from './financeSettings.js'

// Admin dispatch controls (Delivery manager, Dispatch operator, Super admin — enforced by the staff guard) and the
// rider's "I've arrived" step. Every change is guarded (conditional writes) so two people can't act on the same
// delivery at once, and every admin action is in the audit log.

export class DispatchError extends Error {
  constructor(code, message, status = 409) { super(message); this.code = code; this.status = status }
}

export const BEFORE_PICKUP = ['REQUESTED', 'ACCEPTED', 'GOING_TO_RESTAURANT', 'ARRIVED_AT_RESTAURANT']
export const ON_THE_WAY = ['PICKED_UP', 'GOING_TO_CUSTOMER']
export const FAILURE_REASONS = {
  CUSTOMER_UNREACHABLE: 'Customer couldn’t be reached',
  WRONG_ADDRESS: 'Address couldn’t be found',
  CUSTOMER_REFUSED: 'Customer refused the order',
  ROAD_INACCESSIBLE: 'Road impassable or unsafe',
  RIDER_INCIDENT: 'Rider incident (accident, breakdown)',
  ORDER_DAMAGED: 'Order damaged or lost',
  OTHER: 'Other',
}

/** Order status to return to when a rider is taken off a job before pickup. */
export const orderStatusAfterUnassign = (order) => (order.preparedAt || order.status === 'READY_FOR_PICKUP' ? 'READY_FOR_PICKUP' : 'PREPARING')

/**
 * Takes a food delivery off its rider before pickup (rider can't make it, wrong rider, too slow).
 * The job goes back to waiting; the caller can then offer it to someone else (or automatic dispatch picks it up).
 */
export async function unassignRider(db, deliveryId, admin, { reason }, { notifyUsers } = {}) {
  return db.$transaction(async (tx) => {
    const delivery = await tx.delivery.findUnique({ where: { id: deliveryId }, include: { order: { select: { id: true, orderNumber: true, status: true, preparedAt: true } }, rider: { select: { id: true, userId: true } } } })
    if (!delivery?.order) throw new DispatchError('DELIVERY_NOT_FOUND', 'Delivery not found.', 404)
    const riderId = delivery.riderId || delivery.requestedRiderId
    if (!riderId) throw new DispatchError('NO_RIDER', 'This delivery has no rider to take off.')
    if (!BEFORE_PICKUP.includes(delivery.status)) throw new DispatchError('ALREADY_PICKED_UP', 'The rider already has the order. Use “Delivery failed” or call the rider.')
    const changed = await tx.delivery.updateMany({ where: { id: deliveryId, status: delivery.status, riderId: delivery.riderId }, data: { status: 'AVAILABLE', riderId: null, requestedRiderId: null, requestExpiresAt: null, acceptedAt: null, stuckAlertedAt: null } })
    if (changed.count !== 1) throw new DispatchError('DELIVERY_STATE_CHANGED', 'This delivery just changed. Refresh and try again.')
    await tx.dispatchOffer.updateMany({ where: { deliveryId, riderId, status: { in: ['OFFERED', 'ACCEPTED'] } }, data: { status: 'REMOVED_BY_ADMIN', respondedAt: new Date() } })
    if (delivery.order.status === 'RIDER_ASSIGNED') await tx.order.update({ where: { id: delivery.order.id }, data: { status: orderStatusAfterUnassign(delivery.order) } })
    await tx.auditLog.create({ data: { actorId: admin.id, action: 'DELIVERY_RIDER_REMOVED', entityType: 'Delivery', entityId: deliveryId, metadata: { orderNumber: delivery.order.orderNumber, riderId, previousStatus: delivery.status, reason } } })
    const rider = delivery.rider || await tx.rider.findUnique({ where: { id: riderId }, select: { userId: true } })
    if (notifyUsers && rider?.userId) await notifyUsers(tx, [rider.userId], { type: 'DELIVERY', title: `Job ${delivery.order.orderNumber} was moved`, body: 'DOORSTEP gave this job to another rider. You don’t need to go to the store.', link: '/rider/dashboard' })
    return { deliveryId, orderNumber: delivery.order.orderNumber, previousRiderId: riderId }
  })
}

/**
 * A delivery that couldn't be completed after pickup. The admin records why, whether the customer is refunded
 * (full, part or none → the refund queue) and what the rider is paid for the trip. The business keeps its share
 * (it prepared the order). The order is cancelled; nothing is deleted.
 */
export async function failDelivery(db, deliveryId, admin, { reason, note, refundMinor = 0, riderPayMinor = null }, { notifyUsers } = {}) {
  if (!FAILURE_REASONS[reason]) throw new DispatchError('INVALID_REASON', 'Choose why the delivery failed.', 400)
  const settings = await getFinanceSettings(db)
  return db.$transaction(async (tx) => {
    const delivery = await tx.delivery.findUnique({ where: { id: deliveryId }, include: { order: { include: { payment: true } }, rider: { select: { id: true, userId: true, network: true } } } })
    if (!delivery?.order) throw new DispatchError('DELIVERY_NOT_FOUND', 'Delivery not found.', 404)
    if (!ON_THE_WAY.includes(delivery.status)) throw new DispatchError('NOT_ON_THE_WAY', BEFORE_PICKUP.includes(delivery.status) ? 'The rider hasn’t picked the order up. Take the rider off the job instead.' : 'This delivery is already finished.')
    const order = delivery.order
    const paid = order.payment?.status === 'SUCCESSFUL' ? order.payment.amountMinor : 0
    if (!(Number.isInteger(refundMinor) && refundMinor >= 0 && refundMinor <= paid)) throw new DispatchError('INVALID_REFUND', `The refund can be between ₦0 and what the customer paid (₦${(paid / 100).toLocaleString('en-NG')}).`, 400)
    if (riderPayMinor != null && !(Number.isInteger(riderPayMinor) && riderPayMinor >= 0 && riderPayMinor <= 5_000_000)) throw new DispatchError('INVALID_RIDER_PAY', 'Check the rider’s pay.', 400)
    const now = new Date()
    const changed = await tx.delivery.updateMany({ where: { id: deliveryId, status: delivery.status }, data: { status: 'CANCELLED', cancelledAt: now, failedAt: now, failureReason: reason, failureNote: note || null } })
    if (changed.count !== 1) throw new DispatchError('DELIVERY_STATE_CHANGED', 'This delivery just changed. Refresh and try again.')
    await tx.order.update({ where: { id: order.id }, data: { status: 'CANCELLED', cancelledAt: now, cancellationReason: `Delivery failed: ${FAILURE_REASONS[reason]}${note ? ` — ${note}` : ''}` } })
    if (refundMinor > 0) await tx.transaction.create({ data: { paymentId: order.payment.id, type: 'REFUND_REQUIRED', amountMinor: refundMinor, providerReference: order.payment.reference, metadata: { reason: 'delivery_failed', failure: reason, note: note || null, partial: refundMinor < paid, decidedBy: admin.id } } })
    // Rider pay for the trip they made (a DOORSTEP rider; a business's own rider is paid by the business).
    let riderEntry = null
    if (delivery.rider && delivery.rider.network !== 'BUSINESS_OWNED' && riderPayMinor) {
      riderEntry = { orderId: order.id, party: 'RIDER', riderId: delivery.rider.id, type: 'RIDER_EARNING', amountMinor: riderPayMinor, status: 'DUE', description: `${order.orderNumber} · delivery attempt (couldn’t be completed)`, dedupeKey: `RIDER_EARNING:order:${order.id}` }
      const fees = riderFeeEntries({ riderId: delivery.rider.id, orderId: order.id, source: `order:${order.id}`, label: order.orderNumber }, riderPayMinor, settings)
      await tx.ledgerEntry.createMany({ data: [riderEntry, ...fees], skipDuplicates: true })
    }
    await tx.auditLog.create({ data: { actorId: admin.id, action: 'DELIVERY_FAILED', entityType: 'Delivery', entityId: deliveryId, metadata: { orderNumber: order.orderNumber, reason, note: note || null, refundMinor, riderPayMinor: riderEntry ? riderPayMinor : 0 } } })
    if (notifyUsers) {
      await notifyUsers(tx, [order.customerId], { type: 'ORDER', title: `Order ${order.orderNumber} couldn’t be delivered`, body: `${FAILURE_REASONS[reason]}.${refundMinor ? ` We’re refunding ₦${(refundMinor / 100).toLocaleString('en-NG')} to you.` : ''} Chat with DOORSTEP Help if you have questions.`, link: `/account/orders/${order.id}` })
      if (delivery.rider?.userId) await notifyUsers(tx, [delivery.rider.userId], { type: 'DELIVERY', title: `Job ${order.orderNumber} closed`, body: riderEntry ? `DOORSTEP recorded ₦${(riderPayMinor / 100).toLocaleString('en-NG')} for this trip.` : 'DOORSTEP closed this job. Contact support about returning the order if needed.', link: '/rider/earnings' })
    }
    return { orderNumber: order.orderNumber, refundMinor, riderPayMinor: riderEntry ? riderPayMinor : 0 }
  })
}

/** Rider: "I've arrived" at the customer. Records the time (for waiting pay) and tells the customer. Once only. */
export async function markArrived(db, deliveryId, rider, { notifyUsers } = {}) {
  const delivery = await db.delivery.findUnique({ where: { id: deliveryId }, select: { id: true, riderId: true, status: true, arrivedAtCustomerAt: true, order: { select: { id: true, orderNumber: true, customerId: true } } } })
  if (!delivery?.order || delivery.riderId !== rider?.id) throw new DispatchError('ASSIGNED_RIDER_REQUIRED', 'Only the rider on this job can do this.', 403)
  if (delivery.status !== 'GOING_TO_CUSTOMER') throw new DispatchError('NOT_ON_THE_WAY', 'Start the trip to the customer first.')
  if (delivery.arrivedAtCustomerAt) return { arrivedAt: delivery.arrivedAtCustomerAt, already: true }
  const now = new Date()
  const changed = await db.delivery.updateMany({ where: { id: deliveryId, arrivedAtCustomerAt: null }, data: { arrivedAtCustomerAt: now } })
  if (changed.count === 1 && notifyUsers) await notifyUsers(db, [delivery.order.customerId], { type: 'DELIVERY', title: 'Your rider has arrived', body: `Your rider is outside with order ${delivery.order.orderNumber}. Have your delivery code ready.`, link: `/account/orders/${delivery.order.id}` })
  return { arrivedAt: now, already: changed.count !== 1 }
}
