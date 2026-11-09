// Order chat (Glovo-style): short, order-only conversations that open when a rider is on the order and close after
// the job. Two channels per order:
//   CUSTOMER_RIDER — customer and rider, from rider assigned until delivered (readable for a day after)
//   STORE_RIDER    — the business and the rider, from rider assigned until pickup (readable for a day after)
// There is no direct customer ↔ business chat (as on Glovo): customers reach businesses through DOORSTEP Help.
// Pure rules only (no database), so they're unit-tested.

export const CHANNELS = ['CUSTOMER_RIDER', 'STORE_RIDER']
export const MAX_MESSAGE_LENGTH = 500
export const READ_ONLY_HOURS = 24
export const RATE_LIMIT = { messages: 20, windowMs: 5 * 60_000 }

const RIDER_ON_ORDER = ['RIDER_ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY']

/**
 * Whether a channel is open for writing / reading for an order right now.
 * order: { status, deliveredAt?, cancelledAt?, updatedAt?, delivery: { riderId, status, pickedUpAt, deliveredAt } }
 */
export function chatWindow(order, channel, now = new Date()) {
  const delivery = order?.delivery
  // A job only offered to a rider (not yet accepted) doesn't open the chat.
  if (!delivery?.riderId || ['AVAILABLE', 'REQUESTED'].includes(delivery.status)) return { canRead: false, canSend: false, reason: 'NO_RIDER' }
  const endedAt = channel === 'STORE_RIDER' ? delivery.pickedUpAt || delivery.deliveredAt || order.cancelledAt : delivery.deliveredAt || order.cancelledAt
  const riderActive = RIDER_ON_ORDER.includes(order.status) || (order.status === 'READY_FOR_PICKUP' || order.status === 'PREPARING' || order.status === 'RESTAURANT_ACCEPTED')
  const pickedUp = Boolean(delivery.pickedUpAt) || ['PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(order.status)
  const open = channel === 'STORE_RIDER' ? riderActive && !pickedUp && !['CANCELLED', 'REJECTED', 'REFUNDED'].includes(order.status) : riderActive && !['DELIVERED', 'CANCELLED', 'REJECTED', 'REFUNDED'].includes(order.status)
  if (open) return { canRead: true, canSend: true, reason: null }
  const recent = endedAt && now - new Date(endedAt) < READ_ONLY_HOURS * 3_600_000
  return { canRead: Boolean(recent), canSend: false, reason: channel === 'STORE_RIDER' && pickedUp ? 'PICKED_UP' : order.status === 'DELIVERED' ? 'DELIVERED' : ['CANCELLED', 'REJECTED', 'REFUNDED'].includes(order.status) ? 'ORDER_CLOSED' : 'CLOSED' }
}

export const CLOSED_TEXT = {
  NO_RIDER: 'Chat opens when a rider is assigned to your order.',
  PICKED_UP: 'This chat closed when the rider picked up the order.',
  DELIVERED: 'This chat closed when the order was delivered.',
  ORDER_CLOSED: 'This order is closed, so the chat is closed.',
  CLOSED: 'This chat is closed.',
}

/** Who someone is in a channel: 'CUSTOMER' | 'RIDER' | 'STORE' | null (not allowed). Admins only read. */
export function participantRole(user, order, channel, { storeMemberIds = [] } = {}) {
  if (!user || !order) return null
  if (user.role === 'RIDER' && user.rider?.id && order.delivery?.riderId === user.rider.id) return 'RIDER'
  if (channel === 'CUSTOMER_RIDER' && user.role === 'CUSTOMER' && order.customerId === user.id) return 'CUSTOMER'
  if (channel === 'STORE_RIDER' && user.role === 'RESTAURANT' && storeMemberIds.includes(user.id)) return 'STORE'
  return null
}

/** Ready-made messages (no typing needed on a bike or at a busy counter). */
export const QUICK_REPLIES = {
  CUSTOMER_RIDER: {
    CUSTOMER: ['I’m outside', 'Please call me when you arrive', 'Leave it at the gate', 'The gate is locked — I’m coming out', 'I’ll be there in 2 minutes', 'Thank you!'],
    RIDER: ['I’ve picked up your order', 'I’m on my way', 'I’m outside', 'I can’t find your address — please share your location', 'I’m at the gate', 'Delivered — enjoy!'],
  },
  STORE_RIDER: {
    STORE: ['Order ready — come to the counter', 'Ready in 5 minutes', 'Please come to the back door', 'One item is delayed, please wait'],
    RIDER: ['I’m outside the store', 'I’m 5 minutes away', 'Is the order ready?', 'I’ve arrived'],
  },
}

// Safety: phone numbers, bank/account numbers, emails and links are hidden so payments and contacts stay in the app
// (Glovo does the same). The Call button still works for the rider and customer.
// Emails are checked before links, so 'name@site.com' is hidden whole (not just 'site.com').
const PATTERNS = [
  [/[\w.+-]+@[\w-]+\.[\w.]+/g, 'email'],
  [/https?:\/\/\S+|www\.\S+|\b[a-z0-9-]+\.(com|ng|net|org|co|io|me|link|ly)(\/\S*)?\b/gi, 'link'],
  [/(?:\+?234|\b0)[\s-]?[789][01]\d(?:[\s-]?\d){7}\b/g, 'phone'],
  [/\b\d(?:[\s-]?\d){9,}\b/g, 'number'],
]
/** Returns { text, hidden: ['phone', …] } with any blocked detail replaced by •••. */
export function screenMessage(input) {
  let text = String(input || '').replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE_LENGTH)
  const hidden = []
  for (const [pattern, kind] of PATTERNS) {
    if (pattern.test(text)) { hidden.push(kind); text = text.replace(pattern, '•••') }
    pattern.lastIndex = 0
  }
  return { text, hidden: [...new Set(hidden)] }
}
export const HIDDEN_TEXT = 'For everyone’s safety, phone numbers, account numbers and links are hidden in chat. Use the Call button instead.'

/** Simple sliding-window limit: true when the sender may post another message. */
export function underRateLimit(recentTimes, now = Date.now()) {
  return recentTimes.filter((time) => now - new Date(time).getTime() < RATE_LIMIT.windowMs).length < RATE_LIMIT.messages
}

/** Valid shared pin (Nigeria's rough bounds) or null. */
export function cleanLocation(location) {
  const latitude = Number(location?.latitude)
  const longitude = Number(location?.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (latitude < 4 || latitude > 14 || longitude < 2.5 || longitude > 15) return null
  return { latitude: Math.round(latitude * 1e6) / 1e6, longitude: Math.round(longitude * 1e6) / 1e6 }
}
