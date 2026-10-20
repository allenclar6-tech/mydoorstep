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
  }
}

export function cancelBlockedMessage(status) {
  if (['RESTAURANT_ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP'].includes(status)) return 'The business has already started on this order, so it can’t be cancelled here. Chat with DOORSTEP Help and we’ll sort it out.'
  if (['RIDER_ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY'].includes(status)) return 'This order is already on its way, so it can’t be cancelled here. Chat with DOORSTEP Help if something is wrong.'
  if (status === 'CANCELLED') return 'This order is already cancelled.'
  return 'This order can’t be cancelled any more.'
}
