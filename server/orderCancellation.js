// Customer self-service for orders: cancel (with an automatic refund when already paid) and remove from history.
// Orders are never erased from the database: payments, commission and tax records must be kept, so "delete"
// hides the order from the customer's own list.

export const CANCELLABLE_BEFORE_PAYMENT = ['PENDING_PAYMENT']
// Once paid, the customer can still cancel until the business accepts the order.
export const CANCELLABLE_AFTER_PAYMENT = ['PAID']
export const REMOVABLE_FROM_HISTORY = ['CANCELLED', 'DELIVERED', 'REJECTED', 'REFUNDED']

export class OrderActionError extends Error {
  constructor(code, message, status = 409) { super(message); this.code = code; this.status = status }
}

/** What the customer may do with an order right now. Used by the API and shown in the app. */
export function orderActions(order) {
  const unpaid = CANCELLABLE_BEFORE_PAYMENT.includes(order.status)
  return {
    canCancel: unpaid || CANCELLABLE_AFTER_PAYMENT.includes(order.status),
    cancelNeedsRefund: CANCELLABLE_AFTER_PAYMENT.includes(order.status),
    canRemove: unpaid || REMOVABLE_FROM_HISTORY.includes(order.status),
    // Unpaid orders can be paid (again) — e.g. after a declined card or an OPay "denied by fraud system".
    canPay: unpaid,
  }
}

export function cancelBlockedMessage(status) {
  if (['RESTAURANT_ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP'].includes(status)) return 'The business has already started on this order, so it can’t be cancelled here. Chat with DOORSTEP Help and we’ll sort it out.'
  if (['RIDER_ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY'].includes(status)) return 'This order is already on its way, so it can’t be cancelled here. Chat with DOORSTEP Help if something is wrong.'
  if (status === 'CANCELLED') return 'This order is already cancelled.'
  return 'This order can’t be cancelled any more.'
}

/* ------------------------------ order notifications ------------------------------ */
// Notifications have no order column, so an order's notifications are found by their link to the order page or by
// the order number in the text. Order numbers look like DSP-20261020-AB12CD, so a text match can't hit another order.
export function orderNotificationWhere(order) {
  const link = `/account/orders/${order.id}`
  const match = [{ link }, { link: { startsWith: `${link}?` } }, { link: { startsWith: `${link}#` } }]
  if (order.orderNumber) match.push({ body: { contains: order.orderNumber } }, { title: { contains: order.orderNumber } })
  return { OR: match }
}

/** Customer removed the order from their list: its notifications go from their inbox too (and stop counting as unread). */
export async function removeOrderNotifications(db, order, userId) {
  const { count } = await db.notification.deleteMany({ where: { userId, ...orderNotificationWhere(order) } })
  return count
}

/**
 * The order was cancelled or declined: earlier unread notifications about it (new-order alerts, rider offers,
 * "being prepared"…) are now out of date, so they are marked read for everyone. Notices created at or after
 * `before` — the cancellation messages themselves — stay unread.
 */
export async function retireOrderNotifications(db, order, before) {
  const { count } = await db.notification.updateMany({ where: { readAt: null, createdAt: { lt: before }, ...orderNotificationWhere(order) }, data: { readAt: new Date() } })
  return count
}
