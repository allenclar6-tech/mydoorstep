// Promo codes and automatic offers (e.g. first-order free delivery).
// DOORSTEP funds every discount out of its own part of the order (commission + service fee + delivery fee it
// keeps), so the business is always paid its full share and the Paystack split stays valid.

export const PROMO_TYPES = ['FREE_DELIVERY', 'PERCENT', 'FIXED']
export const VERTICALS = ['FOOD', 'GROCERIES', 'SHOPS', 'PHARMACY_BEAUTY']
// An unpaid order holds its promo for this long; after that the promo can be used again.
export const PENDING_HOLD_MS = 2 * 60 * 60_000
const CLOSED = ['CANCELLED', 'REJECTED', 'REFUNDED']

export const normalizeCode = (value) => String(value || '').trim().toUpperCase().replace(/\s+/g, '')

export function verticalOf(store) {
  if (store?.vertical && VERTICALS.includes(store.vertical)) return store.vertical
  return store?.storeType === 'GROCERY' ? 'GROCERIES' : 'FOOD'
}

/** Raw discount for a promo before DOORSTEP's room is applied. */
export function rawDiscount(promo, { subtotalMinor, deliveryFeeMinor }) {
  if (promo.type === 'FREE_DELIVERY') return Math.max(0, deliveryFeeMinor || 0)
  if (promo.type === 'PERCENT') {
    const percent = Number(promo.percentage || 0)
    const value = Math.round((subtotalMinor || 0) * percent / 100)
    return Math.max(0, promo.maxDiscountMinor ? Math.min(value, promo.maxDiscountMinor) : value)
  }
  if (promo.type === 'FIXED') return Math.max(0, Math.min(promo.valueMinor || 0, subtotalMinor || 0))
  return 0
}

/** How a promo reads to customers: “Free delivery”, “10% off (up to ₦1,000)”, “₦500 off”. */
export function promoLabel(promo) {
  const naira = (minor) => `₦${Math.round(minor / 100).toLocaleString('en-NG')}`
  if (promo.type === 'FREE_DELIVERY') return 'Free delivery'
  if (promo.type === 'PERCENT') return `${Number(promo.percentage)}% off${promo.maxDiscountMinor ? ` (up to ${naira(promo.maxDiscountMinor)})` : ''}`
  return `${naira(promo.valueMinor || 0)} off`
}

/** Orders that still "use" a promo: not closed, and not an unpaid order older than the hold. */
export function liveOrderWhere(now = new Date()) {
  return { status: { notIn: CLOSED }, OR: [{ status: { not: 'PENDING_PAYMENT' } }, { createdAt: { gt: new Date(now.getTime() - PENDING_HOLD_MS) } }] }
}

/** Has this customer had a real order before (paid, in progress or delivered)? */
export async function hasEarlierOrder(db, customerId, { excludeOrderId } = {}) {
  const count = await db.order.count({ where: { customerId, status: { notIn: [...CLOSED, 'PENDING_PAYMENT'] }, ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}) } })
  return count > 0
}

/**
 * Why a promo can't be used for this basket (null = it can).
 * ctx: { customerId, restaurantId, vertical, subtotalMinor, deliveryFeeMinor, orderType, now }
 */
export async function promoProblem(db, promo, ctx) {
  const now = ctx.now || new Date()
  const naira = (minor) => `₦${Math.round(minor / 100).toLocaleString('en-NG')}`
  if (!promo || !promo.active) return { code: 'PROMO_NOT_FOUND', message: 'That code isn’t valid.' }
  if (new Date(promo.startsAt) > now) return { code: 'PROMO_NOT_STARTED', message: 'This offer hasn’t started yet.' }
  if (new Date(promo.endsAt) < now) return { code: 'PROMO_EXPIRED', message: 'This offer has ended.' }
  if (promo.restaurantId && promo.restaurantId !== ctx.restaurantId) return { code: 'PROMO_OTHER_STORE', message: 'This code is for a different store.' }
  if (promo.vertical && promo.vertical !== ctx.vertical) return { code: 'PROMO_OTHER_SECTION', message: 'This code doesn’t work for this kind of store.' }
  if (promo.type === 'FREE_DELIVERY' && ctx.orderType === 'PICKUP') return { code: 'PROMO_DELIVERY_ONLY', message: 'Free delivery doesn’t apply to pickup orders — there’s no delivery fee to take off.' }
  if ((promo.minSubtotalMinor || 0) > (ctx.subtotalMinor || 0)) return { code: 'PROMO_MINIMUM', message: `Add ${naira(promo.minSubtotalMinor - (ctx.subtotalMinor || 0))} more to use this offer (minimum basket ${naira(promo.minSubtotalMinor)}).` }
  if (rawDiscount(promo, ctx) <= 0) return { code: 'PROMO_NOTHING_OFF', message: 'This offer doesn’t take anything off this order.' }
  if (promo.firstOrderOnly && await hasEarlierOrder(db, ctx.customerId)) return { code: 'PROMO_FIRST_ORDER', message: 'This offer is for your first DOORSTEP order.' }
  const live = liveOrderWhere(now)
  if (promo.perCustomerLimit) {
    const mine = await db.order.count({ where: { promotionId: promo.id, customerId: ctx.customerId, ...live, ...(ctx.excludeOrderId ? { id: { not: ctx.excludeOrderId } } : {}) } })
    if (mine >= promo.perCustomerLimit) return { code: 'PROMO_ALREADY_USED', message: promo.perCustomerLimit === 1 ? 'You’ve already used this offer.' : `You’ve used this offer ${mine} times — that’s the limit.` }
  }
  if (promo.usageLimit) {
    const all = await db.order.count({ where: { promotionId: promo.id, ...live } })
    if (all >= promo.usageLimit) return { code: 'PROMO_SOLD_OUT', message: 'This offer has been fully used.' }
  }
  return null
}

/**
 * Picks the promo for a basket: the typed code if there is one, otherwise the best automatic offer.
 * `roomMinor` is the most DOORSTEP can give away on this order (its own share), so the discount never cuts into
 * the business's share. Returns { promotion, discountMinor, label, auto, problem }.
 */
export async function choosePromotion(db, ctx, { code, roomMinor }) {
  const now = ctx.now || new Date()
  const cap = (value) => Math.max(0, Math.min(value, roomMinor ?? value))
  const typed = normalizeCode(code)
  if (typed) {
    const promo = await db.promotion.findFirst({ where: { code: typed } })
    const problem = await promoProblem(db, promo, { ...ctx, now })
    if (problem) return { promotion: null, discountMinor: 0, problem, code: typed }
    const discountMinor = cap(rawDiscount(promo, ctx))
    return { promotion: promo, discountMinor, label: promoLabel(promo), auto: false, code: typed, capped: discountMinor < rawDiscount(promo, ctx) }
  }
  const candidates = await db.promotion.findMany({ where: { autoApply: true, active: true, startsAt: { lte: now }, endsAt: { gte: now } }, orderBy: { createdAt: 'asc' }, take: 20 })
  let best = null
  for (const promo of candidates) {
    if (await promoProblem(db, promo, { ...ctx, now })) continue
    const discountMinor = cap(rawDiscount(promo, ctx))
    if (discountMinor > 0 && (!best || discountMinor > best.discountMinor)) best = { promotion: promo, discountMinor, label: promoLabel(promo), auto: true, code: null }
  }
  return best || { promotion: null, discountMinor: 0 }
}

/** DOORSTEP's own part of an order — the most a promo may take off. */
export function platformRoom(shares) {
  return Math.max(0, (shares.commissionMinor || 0) + (shares.serviceFeeMinor || 0) + (shares.deliveryFeeToPlatformMinor || 0))
}

/** Public view of a promo for the app (no usage counters). */
export function publicPromotion(promo) {
  return { id: promo.id, name: promo.name, code: promo.code, type: promo.type, label: promoLabel(promo), description: promo.description, minSubtotalMinor: promo.minSubtotalMinor || 0, firstOrderOnly: promo.firstOrderOnly, autoApply: promo.autoApply, endsAt: promo.endsAt, restaurantId: promo.restaurantId, vertical: promo.vertical }
}

// Tips -----------------------------------------------------------------------------------------------------------
export const MAX_TIP_MINOR = 500_000
export function cleanTip(value, orderType) {
  if (orderType === 'PICKUP') return 0
  const tip = Math.round(Number(value) || 0)
  return Math.max(0, Math.min(tip, MAX_TIP_MINOR))
}

// Scheduling -----------------------------------------------------------------------------------------------------
export const SCHEDULE_MIN_LEAD_MS = 45 * 60_000
export const SCHEDULE_MAX_AHEAD_MS = 7 * 24 * 60 * 60_000
// A scheduled delivery is offered to riders this long before the customer's time.
export const SCHEDULE_DISPATCH_LEAD_MS = 35 * 60_000

/** Validates a requested time; returns { at } or { problem }. */
export function checkSchedule(value, now = new Date()) {
  if (value == null || value === '') return { at: null }
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return { problem: 'Choose a valid time.' }
  if (at.getTime() < now.getTime() + SCHEDULE_MIN_LEAD_MS - 60_000) return { problem: 'Scheduled orders need at least 45 minutes’ notice.' }
  if (at.getTime() > now.getTime() + SCHEDULE_MAX_AHEAD_MS) return { problem: 'You can schedule up to 7 days ahead.' }
  return { at }
}

/** Is a scheduled order too early to send to riders? */
export function heldForSchedule(order, now = new Date()) {
  return Boolean(order?.scheduledFor) && new Date(order.scheduledFor).getTime() - SCHEDULE_DISPATCH_LEAD_MS > now.getTime()
}
