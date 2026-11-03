import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { authenticateBearerToken } from './auth.js'
import { deliverability, discoverSections, etaRange, medianItemPrice } from './customerApp.js'
import { pricingZones, quoteOrderDelivery } from './deliveryQuote.js'
import { itemStats, PUBLIC_REVIEW_SELECT, publicReview, reviewMentionsItem } from './reviewsPublic.js'
import { getDeliveryPricing } from './deliveryPricingSettings.js'
import { notifyAdmins } from './notify.js'
import { PAUSE_CHOICES, pausedNow, todayStats } from './partnerToday.js'
import { countOpenRefunds } from './refundRoutes.js'
import { hasEarlierOrder, liveOrderWhere, normalizeCode, PROMO_TYPES, promoLabel, promoProblem, publicPromotion, VERTICALS } from './promotions.js'

// Customer app API: home feed with Discover rankings, "do you deliver here?", offers and promo codes,
// plus the admin screen for promo codes and the business's pickup switch.

const DAY = 86_400_000

async function optionalUser(request) {
  const header = request.get('authorization') || ''
  if (!header.startsWith('Bearer ')) return null
  try { return (await authenticateBearerToken(header.slice(7)))?.user || null } catch { return null }
}

const promoInput = z.object({
  name: z.string().trim().min(2).max(80),
  code: z.string().trim().max(24).optional().nullable().transform((value) => value ? normalizeCode(value) : null),
  type: z.enum(PROMO_TYPES),
  percentage: z.number().min(1).max(100).optional().nullable(),
  valueMinor: z.number().int().min(100).max(10_000_000).optional().nullable(),
  maxDiscountMinor: z.number().int().min(100).max(10_000_000).optional().nullable(),
  minSubtotalMinor: z.number().int().min(0).max(10_000_000).default(0),
  description: z.string().trim().max(240).optional().nullable(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  usageLimit: z.number().int().min(1).max(1_000_000).optional().nullable(),
  perCustomerLimit: z.number().int().min(1).max(100).default(1),
  firstOrderOnly: z.boolean().default(false),
  autoApply: z.boolean().default(false),
  showInApp: z.boolean().default(true),
  vertical: z.enum(VERTICALS).optional().nullable(),
  restaurantId: z.string().min(1).optional().nullable(),
  active: z.boolean().default(true),
}).superRefine((value, context) => {
  if (value.endsAt <= value.startsAt) context.addIssue({ code: 'custom', path: ['endsAt'], message: 'The end date must be after the start date.' })
  if (value.type === 'PERCENT' && !value.percentage) context.addIssue({ code: 'custom', path: ['percentage'], message: 'Enter the percentage off.' })
  if (value.type === 'FIXED' && !value.valueMinor) context.addIssue({ code: 'custom', path: ['valueMinor'], message: 'Enter the amount off.' })
  if (!value.autoApply && !value.code) context.addIssue({ code: 'custom', path: ['code'], message: 'Give the promo a code, or switch on “apply automatically”.' })
})

export function createCustomerAppRouter({ prisma, requireUser, requireAdmin, publicRestaurant, isOpen = () => true }) {
  const router = Router()
  const checkLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false })

  // Home + Discover: every approved store with real order counts from the last 30 days.
  router.get('/app/home', async (request, response) => {
    try {
      const since = new Date(Date.now() - 30 * DAY)
      const now = new Date()
      const [restaurants, recent, delivered, promotions, user] = await Promise.all([
        prisma.restaurant.findMany({ where: { status: 'APPROVED' }, include: { city: { include: { serviceAreas: true } }, users: { where: { role: 'OWNER' }, orderBy: { createdAt: 'asc' }, select: { userId: true, user: { select: { profileImageKey: true } } } }, menuItems: { where: { categoryId: null, available: true } }, categories: { include: { items: { where: { available: true } } } } }, orderBy: { ratingAverage: 'desc' }, take: 120 }),
        prisma.order.groupBy({ by: ['restaurantId'], where: { createdAt: { gte: since }, status: { notIn: ['PENDING_PAYMENT', 'CANCELLED', 'REJECTED', 'REFUNDED'] } }, _count: { _all: true } }),
        prisma.order.groupBy({ by: ['restaurantId'], where: { deliveredAt: { gte: since }, status: 'DELIVERED' }, _count: { _all: true } }),
        prisma.promotion.findMany({ where: { active: true, showInApp: true, startsAt: { lte: now }, endsAt: { gte: now } }, orderBy: { createdAt: 'desc' }, take: 12 }),
        optionalUser(request),
      ])
      const stats = new Map()
      for (const row of recent) stats.set(row.restaurantId, { orders30: row._count._all, delivered30: 0 })
      for (const row of delivered) stats.set(row.restaurantId, { ...(stats.get(row.restaurantId) || { orders30: 0 }), delivered30: row._count._all })
      const stores = restaurants.map((restaurant) => {
        const card = publicRestaurant(restaurant)
        const stat = stats.get(restaurant.id) || { orders30: 0, delivered30: 0 }
        return { ...card, createdAt: restaurant.createdAt, ordersLast30Days: stat.orders30, deliveredLast30Days: stat.delivered30, medianPriceMinor: medianItemPrice(card), eta: etaRange(card) }
      })
      const sections = discoverSections(stores, stats)
      const customer = user?.role === 'CUSTOMER' ? user : null
      const firstOrder = customer ? !(await hasEarlierOrder(prisma, customer.id)) : null
      const offers = promotions.filter((promo) => !(promo.firstOrderOnly && firstOrder === false)).map(publicPromotion)
      response.set('Cache-Control', customer ? 'private, no-store' : 'public, max-age=60, stale-while-revalidate=300')
      return response.json({ stores, sections, offers, firstOrder: { eligible: firstOrder, offer: offers.find((offer) => offer.firstOrderOnly && offer.autoApply) || null } })
    } catch (error) {
      console.error('[app] home_failed', error?.message)
      return response.status(503).json({ error: 'APP_HOME_UNAVAILABLE' })
    }
  })

  // One store page: menu, best sellers (from real orders), recent reviews and the fee facts.
  router.get('/app/stores/:slug', async (request, response) => {
    try {
      const restaurant = await prisma.restaurant.findFirst({ where: { slug: request.params.slug, status: 'APPROVED' }, include: { city: { include: { serviceAreas: true } }, users: { where: { role: 'OWNER' }, orderBy: { createdAt: 'asc' }, select: { userId: true, user: { select: { profileImageKey: true } } } }, menuItems: { where: { categoryId: null, available: true }, include: { optionGroups: { include: { options: { where: { active: true } } } } } }, categories: { include: { items: { where: { available: true }, include: { optionGroups: { include: { options: { where: { active: true } } } } } } } } } })
      if (!restaurant) return response.status(404).json({ error: 'STORE_NOT_FOUND' })
      const since = new Date(Date.now() - 60 * DAY)
      const [sellers, reviews, orders30] = await Promise.all([
        prisma.orderItem.groupBy({ by: ['menuItemId'], where: { order: { restaurantId: restaurant.id, createdAt: { gte: since }, status: { notIn: ['PENDING_PAYMENT', 'CANCELLED', 'REJECTED', 'REFUNDED'] } } }, _sum: { quantity: true }, orderBy: { _sum: { quantity: 'desc' } }, take: 8 }),
        prisma.review.findMany({ where: { restaurantId: restaurant.id, moderatedAt: { not: null } }, select: PUBLIC_REVIEW_SELECT, orderBy: { createdAt: 'desc' }, take: 500 }),
        prisma.order.count({ where: { restaurantId: restaurant.id, createdAt: { gte: new Date(Date.now() - 30 * DAY) }, status: { notIn: ['PENDING_PAYMENT', 'CANCELLED', 'REJECTED', 'REFUNDED'] } } }),
      ])
      const card = publicRestaurant(restaurant)
      return response.json({ store: { ...card, ordersLast30Days: orders30, eta: etaRange(card), pickupEta: etaRange(card, { orderType: 'PICKUP' }) }, topSellerIds: sellers.filter((row) => row.menuItemId && row._sum.quantity > 0).map((row) => row.menuItemId), reviews: reviews.slice(0, 8).map(publicReview), reviewCount: reviews.length, itemStats: itemStats(reviews) })
    } catch (error) {
      console.error('[app] store_failed', error?.message)
      return response.status(503).json({ error: 'STORE_SERVICE_UNAVAILABLE' })
    }
  })

  // "Do you deliver here?" for the address sheet and the out-of-area screen.
  router.post('/delivery/check', checkLimiter, async (request, response) => {
    const parsed = z.object({ latitude: z.number().gte(-90).lte(90).optional(), longitude: z.number().gte(-180).lte(180).optional(), addressLine: z.string().trim().max(240).optional() }).safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_DELIVERY_CHECK' })
    try {
      const pricing = await getDeliveryPricing(prisma)
      const zones = await pricingZones(prisma, pricing)
      const point = parsed.data.latitude != null && parsed.data.longitude != null ? { latitude: parsed.data.latitude, longitude: parsed.data.longitude } : null
      return response.json(deliverability({ point, addressLine: parsed.data.addressLine }, { pricing, zones }))
    } catch { return response.status(503).json({ error: 'DELIVERY_CHECK_UNAVAILABLE' }) }
  })

  // Offers a signed-in customer can use right now, with the reason when one doesn't apply to them.
  router.get('/promos/available', requireUser, async (request, response) => {
    try {
      const now = new Date()
      const promotions = await prisma.promotion.findMany({ where: { active: true, showInApp: true, startsAt: { lte: now }, endsAt: { gte: now } }, orderBy: { createdAt: 'desc' }, take: 30 })
      const rows = []
      for (const promo of promotions) {
        // Basket-specific checks (minimum, store) are left for checkout; here only "is it still yours to use?".
        const problem = await promoProblem(prisma, promo, { customerId: request.user.id, restaurantId: promo.restaurantId, vertical: promo.vertical, subtotalMinor: Math.max(promo.minSubtotalMinor || 0, 1_000_000), deliveryFeeMinor: 100_000, orderType: 'DELIVERY', now })
        rows.push({ ...publicPromotion(promo), usable: !problem, problem: problem?.message || null })
      }
      return response.json({ promotions: rows })
    } catch { return response.status(503).json({ error: 'PROMO_SERVICE_UNAVAILABLE' }) }
  })

  // Customer asks for their account and data to be deleted. An admin handles it (orders and payments must be
  // kept for the legal period), so this opens a support ticket instead of deleting anything straight away.
  router.post('/account/deletion-request', requireUser, async (request, response) => {
    const parsed = z.object({ reason: z.string().trim().max(500).optional() }).safeParse(request.body || {})
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_REQUEST' })
    try {
      const open = await prisma.supportTicket.findFirst({ where: { userId: request.user.id, category: 'ACCOUNT_DELETION', status: { in: ['OPEN', 'IN_PROGRESS'] } } })
      if (open) return response.json({ ticket: { ticketNumber: open.ticketNumber }, duplicate: true })
      const ticket = await prisma.supportTicket.create({ data: { ticketNumber: `DEL-${Date.now().toString(36).toUpperCase()}`, userId: request.user.id, category: 'ACCOUNT_DELETION', description: `Customer asked to delete their DOORSTEP account and data.${parsed.data.reason ? ` Reason: ${parsed.data.reason}` : ''}` } })
      await notifyAdmins(prisma, { type: 'ACCOUNT', title: 'Account deletion request', body: `${request.user.firstName || 'A customer'} (${request.user.email || request.user.phone || request.user.id}) asked to delete their account. Ticket ${ticket.ticketNumber}.`, link: '/admin/support' }).catch(() => undefined)
      return response.status(201).json({ ticket: { ticketNumber: ticket.ticketNumber } })
    } catch { return response.status(503).json({ error: 'ACCOUNT_SERVICE_UNAVAILABLE' }) }
  })

  // Business: switch customer pickup on or off.
  router.patch('/restaurant/store-options', requireUser, async (request, response) => {
    if (request.user.role !== 'RESTAURANT') return response.status(403).json({ error: 'RESTAURANT_ROLE_REQUIRED' })
    const parsed = z.object({ pickupEnabled: z.boolean() }).safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_STORE_OPTIONS' })
    try {
      const membership = await prisma.restaurantUser.findFirst({ where: { userId: request.user.id }, select: { restaurantId: true } })
      if (!membership) return response.status(404).json({ error: 'RESTAURANT_NOT_FOUND' })
      const restaurant = await prisma.restaurant.update({ where: { id: membership.restaurantId }, data: { pickupEnabled: parsed.data.pickupEnabled }, select: { id: true, pickupEnabled: true } })
      return response.json({ restaurant })
    } catch { return response.status(503).json({ error: 'RESTAURANT_SERVICE_UNAVAILABLE' }) }
  })
  router.get('/restaurant/store-options', requireUser, async (request, response) => {
    if (request.user.role !== 'RESTAURANT') return response.status(403).json({ error: 'RESTAURANT_ROLE_REQUIRED' })
    try {
      const membership = await prisma.restaurantUser.findFirst({ where: { userId: request.user.id }, select: { restaurant: { select: { id: true, pickupEnabled: true, vertical: true, storeType: true } } } })
      if (!membership) return response.status(404).json({ error: 'RESTAURANT_NOT_FOUND' })
      return response.json({ restaurant: membership.restaurant })
    } catch { return response.status(503).json({ error: 'RESTAURANT_SERVICE_UNAVAILABLE' }) }
  })

  // All approved reviews for a store, newest first; ?itemId= shows only reviews about that item.
  router.get('/app/stores/:slug/reviews', async (request, response) => {
    const limit = Math.min(30, Math.max(5, Number(request.query.limit) || 20))
    const itemId = typeof request.query.itemId === 'string' ? request.query.itemId : null
    const cursor = typeof request.query.cursor === 'string' ? request.query.cursor : null
    try {
      const store = await prisma.restaurant.findFirst({ where: { slug: request.params.slug, status: 'APPROVED' }, select: { id: true } })
      if (!store) return response.status(404).json({ error: 'STORE_NOT_FOUND' })
      const where = { restaurantId: store.id, moderatedAt: { not: null }, ...(itemId ? { OR: [{ order: { items: { some: { menuItemId: itemId } } } }] } : {}) }
      const rows = await prisma.review.findMany({ where, select: PUBLIC_REVIEW_SELECT, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) })
      const page = rows.slice(0, limit).filter((review) => !itemId || reviewMentionsItem(review, itemId))
      return response.json({ reviews: page.map(publicReview), nextCursor: rows.length > limit ? rows[limit - 1].id : null })
    } catch { return response.status(503).json({ error: 'REVIEW_SERVICE_UNAVAILABLE' }) }
  })

  // Delivered orders from this store that the signed-in customer hasn't reviewed yet (last 30 days).
  router.get('/app/stores/:slug/my-reviewable', requireUser, async (request, response) => {
    try {
      const store = await prisma.restaurant.findFirst({ where: { slug: request.params.slug }, select: { id: true } })
      if (!store) return response.status(404).json({ error: 'STORE_NOT_FOUND' })
      const orders = await prisma.order.findMany({ where: { restaurantId: store.id, customerId: request.user.id, status: 'DELIVERED', createdAt: { gte: new Date(Date.now() - 30 * DAY) }, reviews: { none: {} } }, select: { id: true, orderNumber: true, createdAt: true, deliveredAt: true, items: { select: { menuItemId: true, nameSnapshot: true, quantity: true } } }, orderBy: { createdAt: 'desc' }, take: 3 })
      return response.json({ orders: orders.map((order) => ({ id: order.id, orderNumber: order.orderNumber, deliveredAt: order.deliveredAt || order.createdAt, items: order.items.map((item) => ({ menuItemId: item.menuItemId, name: item.nameSnapshot, quantity: item.quantity })) })) })
    } catch { return response.status(503).json({ error: 'REVIEW_SERVICE_UNAVAILABLE' }) }
  })

  // The real delivery fee from this store to the customer's address (pin or typed area), for the store page.
  router.post('/app/stores/:slug/delivery-fee', checkLimiter, async (request, response) => {
    const parsed = z.object({ latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional(), addressLine: z.string().trim().max(240).optional(), subtotalMinor: z.number().int().min(0).max(100_000_000).optional() }).safeParse(request.body || {})
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_ADDRESS' })
    const { latitude, longitude, addressLine, subtotalMinor = 0 } = parsed.data
    try {
      const restaurant = await prisma.restaurant.findFirst({ where: { slug: request.params.slug, status: 'APPROVED' }, include: { city: { include: { serviceAreas: true } }, application: { select: { deliveryPreference: true } } } })
      if (!restaurant) return response.status(404).json({ error: 'STORE_NOT_FOUND' })
      const destination = { point: latitude != null && longitude != null ? { latitude, longitude } : null, addressLine }
      // Same price the checkout will charge; until distance pricing is published that is the flat ₦800.
      const quote = await quoteOrderDelivery({ db: prisma, restaurant, destination, subtotalMinor: Math.max(subtotalMinor, restaurant.minimumOrderMinor || 0) })
      if (!quote) return response.json({ feeMinor: 80000, exact: false, basis: 'FLAT' })
      return response.json({ feeMinor: quote.customer.deliveryFeeMinor, km: quote.km, exact: quote.dropoffSource === 'PIN' && quote.distance.source !== 'ASSUMED', basis: quote.dropoffSource })
    } catch (error) {
      if (error?.status) return response.json({ feeMinor: null, problem: error.message })
      return response.status(503).json({ error: 'DELIVERY_PRICING_UNAVAILABLE' })
    }
  })

  // Business "Today" screen: store status, live orders, today's sales, the last 7 days, best sellers.
  const myStore = (userId, select) => prisma.restaurantUser.findFirst({ where: { userId }, select: { restaurant: { select } } }).then((row) => row?.restaurant || null)
  const storeSelect = { id: true, name: true, slug: true, coverImageUrl: true, storeType: true, vertical: true, status: true, temporarilyClosed: true, pausedUntil: true, openingTime: true, closingTime: true, daysOpen: true, ratingAverage: true, ratingCount: true, prepTimeMinutes: true, prepTimeMaxMinutes: true, city: { select: { serviceAreas: { select: { enabled: true, timezone: true } } } } }
  const storeStatus = (store) => {
    const paused = pausedNow(store)
    return { paused, pausedUntil: paused ? store.pausedUntil : null, openNow: isOpen(store), openingTime: store.openingTime, closingTime: store.closingTime }
  }
  router.get('/restaurant/today', requireUser, async (request, response) => {
    if (request.user.role !== 'RESTAURANT') return response.status(403).json({ error: 'RESTAURANT_ROLE_REQUIRED' })
    try {
      const store = await myStore(request.user.id, storeSelect)
      if (!store) return response.status(404).json({ error: 'RESTAURANT_NOT_FOUND' })
      // A timed pause that has run out: switch the store back on for good.
      if (store.temporarilyClosed && store.pausedUntil && !pausedNow(store)) await prisma.restaurant.update({ where: { id: store.id }, data: { temporarilyClosed: false, pausedUntil: null } }).catch(() => undefined)
      const since = new Date(Date.now() - 8 * DAY)
      const orders = await prisma.order.findMany({ where: { restaurantId: store.id, OR: [{ createdAt: { gte: since } }, { status: { in: ['PAID', 'RESTAURANT_ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'RIDER_ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY'] } }] }, select: { status: true, subtotalMinor: true, createdAt: true, items: { select: { nameSnapshot: true, quantity: true } } }, take: 2000 })
      return response.json({
        store: { id: store.id, name: store.name, slug: store.slug, image: store.coverImageUrl, storeType: store.storeType, vertical: store.vertical, approved: store.status === 'APPROVED', rating: Number(store.ratingAverage || 0), ratingCount: store.ratingCount || 0, ...storeStatus(store) },
        ...todayStats(orders),
      })
    } catch { return response.status(503).json({ error: 'RESTAURANT_SERVICE_UNAVAILABLE' }) }
  })

  // Pause: { minutes: 15 | 30 | 60 | 120 } or { minutes: null } for "until I reopen"; { open: true } to reopen now.
  router.patch('/restaurant/pause', requireUser, async (request, response) => {
    if (request.user.role !== 'RESTAURANT') return response.status(403).json({ error: 'RESTAURANT_ROLE_REQUIRED' })
    const parsed = z.union([z.object({ open: z.literal(true) }), z.object({ minutes: z.union([z.literal(null), z.number().int().refine((value) => PAUSE_CHOICES.includes(value))]) })]).safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_PAUSE', message: 'Choose 15, 30, 60 or 120 minutes, or pause until you reopen.' })
    try {
      const store = await myStore(request.user.id, { id: true })
      if (!store) return response.status(404).json({ error: 'RESTAURANT_NOT_FOUND' })
      const data = parsed.data.open ? { temporarilyClosed: false, pausedUntil: null } : { temporarilyClosed: true, pausedUntil: parsed.data.minutes ? new Date(Date.now() + parsed.data.minutes * 60_000) : null }
      const updated = await prisma.restaurant.update({ where: { id: store.id }, data, select: storeSelect })
      return response.json({ store: storeStatus(updated) })
    } catch { return response.status(503).json({ error: 'RESTAURANT_SERVICE_UNAVAILABLE' }) }
  })

  // Admin overview: what needs attention today, in plain words, each with where to go.
  router.get('/admin/todo', requireUser, requireAdmin, async (_request, response) => {
    try {
      const safe = (promise) => promise.catch(() => 0)
      const [businesses, riders, transfers, withdrawals, waiting, tickets, unpinned, pricing, refunds, toPrice, disputed] = await Promise.all([
        safe(prisma.restaurantApplication.count({ where: { status: 'PENDING_APPROVAL' } })),
        safe(prisma.riderApplication.count({ where: { status: 'PENDING_APPROVAL' } })),
        safe(prisma.payment.count({ where: { method: 'BANK_TRANSFER', status: 'PENDING_VERIFICATION' } })),
        safe(prisma.payout.count({ where: { source: 'WITHDRAWAL', status: 'REQUESTED' } })),
        safe(prisma.delivery.count({ where: { riderId: null, orderId: { not: null }, status: { in: ['AVAILABLE', 'REQUESTED'] }, order: { status: { in: ['RESTAURANT_ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP'] } } } })),
        safe(prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } })),
        safe(prisma.restaurant.count({ where: { status: 'APPROVED', OR: [{ latitude: null }, { longitude: null }] } })),
        getDeliveryPricing(prisma).catch(() => null),
        safe(countOpenRefunds(prisma)),
        safe(prisma.ledgerEntry.count({ where: { status: 'NEEDS_REVIEW' } })),
        safe(prisma.payout.count({ where: { status: 'DISPUTED' } })),
      ])
      const items = [
        { key: 'refunds', count: refunds, urgent: true, text: refunds === 1 ? '1 customer is waiting for a refund' : `${refunds} customers are waiting for a refund`, href: '/admin/finance', action: 'Send refunds' },
        { key: 'disputed', count: disputed, urgent: true, text: disputed === 1 ? '1 partner says a payout never arrived' : `${disputed} partners say a payout never arrived`, href: '/admin/finance', action: 'Check payouts' },
        { key: 'waiting', count: waiting, urgent: true, text: waiting === 1 ? '1 order is waiting for a rider' : `${waiting} orders are waiting for a rider`, href: '/admin/deliveries', action: 'Send a rider' },
        { key: 'transfers', count: transfers, urgent: true, text: transfers === 1 ? '1 bank transfer to confirm' : `${transfers} bank transfers to confirm`, href: '/admin/payments', action: 'Check payments' },
        { key: 'withdrawals', count: withdrawals, text: withdrawals === 1 ? '1 partner is asking to withdraw money' : `${withdrawals} partners are asking to withdraw money`, href: '/admin/finance', action: 'Pay them' },
        { key: 'businesses', count: businesses, text: businesses === 1 ? '1 new business is waiting for approval' : `${businesses} new businesses are waiting for approval`, href: '/admin/restaurants', action: 'Review' },
        { key: 'riders', count: riders, text: riders === 1 ? '1 new rider is waiting for approval' : `${riders} new riders are waiting for approval`, href: '/admin/riders', action: 'Review' },
        { key: 'tickets', count: tickets, text: tickets === 1 ? '1 help message is open' : `${tickets} help messages are open`, href: '/admin/support', action: 'Reply' },
        { key: 'unpinned', count: unpinned, text: unpinned === 1 ? '1 business hasn’t pinned its shop on the map' : `${unpinned} businesses haven’t pinned their shop on the map`, href: '/admin/pricing', action: 'See who' },
        { key: 'toPrice', count: toPrice, text: toPrice === 1 ? '1 rider delivery needs its pay set' : `${toPrice} rider deliveries need their pay set`, href: '/admin/finance', action: 'Set pay' },
        { key: 'pricing', count: pricing && !pricing.published ? 1 : 0, text: 'Delivery prices are OFF — customers pay a flat ₦800', href: '/admin/pricing', action: 'Turn on' },
      ].filter((item) => item.count > 0)
      return response.json({ items })
    } catch { return response.status(503).json({ error: 'TODO_UNAVAILABLE' }) }
  })

  // Admin › Promo codes ----------------------------------------------------------------------------------------
  router.get('/admin/promos', requireUser, requireAdmin, async (_request, response) => {
    try {
      const [promotions, stores] = await Promise.all([
        prisma.promotion.findMany({ orderBy: { createdAt: 'desc' }, take: 200, include: { restaurant: { select: { name: true } } } }),
        prisma.restaurant.findMany({ where: { status: 'APPROVED' }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      ])
      const usage = await prisma.order.groupBy({ by: ['promotionId'], where: { promotionId: { in: promotions.map((promo) => promo.id) }, ...liveOrderWhere() }, _count: { _all: true }, _sum: { discountMinor: true } })
      const used = new Map(usage.map((row) => [row.promotionId, { count: row._count._all, discountMinor: row._sum.discountMinor || 0 }]))
      return response.json({ promotions: promotions.map((promo) => ({ ...promo, percentage: promo.percentage == null ? null : Number(promo.percentage), label: promoLabel(promo), storeName: promo.restaurant?.name || null, used: used.get(promo.id) || { count: 0, discountMinor: 0 } })), stores })
    } catch { return response.status(503).json({ error: 'PROMO_SERVICE_UNAVAILABLE' }) }
  })
  const savePromo = async (request, response, id = null) => {
    const parsed = promoInput.safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_PROMO', message: parsed.error.issues[0]?.message || 'Check the promo details.' })
    const data = { ...parsed.data, percentage: parsed.data.type === 'PERCENT' ? parsed.data.percentage : null, valueMinor: parsed.data.type === 'FIXED' ? parsed.data.valueMinor : null, maxDiscountMinor: parsed.data.type === 'PERCENT' ? parsed.data.maxDiscountMinor ?? null : null }
    try {
      const promo = await prisma.$transaction(async (transaction) => {
        const saved = id ? await transaction.promotion.update({ where: { id }, data }) : await transaction.promotion.create({ data })
        await transaction.auditLog.create({ data: { actorId: request.user.id, action: id ? 'UPDATE_PROMOTION' : 'CREATE_PROMOTION', entityType: 'Promotion', entityId: saved.id, metadata: { code: saved.code, type: saved.type } } })
        return saved
      })
      return response.status(id ? 200 : 201).json({ promotion: promo })
    } catch (error) {
      if (error.code === 'P2002') return response.status(409).json({ error: 'PROMO_CODE_TAKEN', message: 'Another promo already uses that code.' })
      if (error.code === 'P2025') return response.status(404).json({ error: 'PROMO_NOT_FOUND' })
      return response.status(503).json({ error: 'PROMO_SERVICE_UNAVAILABLE' })
    }
  }
  router.post('/admin/promos', requireUser, requireAdmin, (request, response) => savePromo(request, response))
  router.put('/admin/promos/:id', requireUser, requireAdmin, (request, response) => savePromo(request, response, request.params.id))
  router.patch('/admin/promos/:id/active', requireUser, requireAdmin, async (request, response) => {
    const parsed = z.object({ active: z.boolean() }).safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_PROMO' })
    try {
      const promotion = await prisma.promotion.update({ where: { id: request.params.id }, data: { active: parsed.data.active } })
      await prisma.auditLog.create({ data: { actorId: request.user.id, action: parsed.data.active ? 'ENABLE_PROMOTION' : 'DISABLE_PROMOTION', entityType: 'Promotion', entityId: promotion.id } })
      return response.json({ promotion })
    } catch { return response.status(404).json({ error: 'PROMO_NOT_FOUND' }) }
  })

  // Admin: which customer-app section a business appears in.
  router.patch('/admin/restaurants/:id/store-section', requireUser, requireAdmin, async (request, response) => {
    const parsed = z.object({ vertical: z.enum(VERTICALS), pickupEnabled: z.boolean().optional() }).safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_STORE_SECTION' })
    try {
      const restaurant = await prisma.restaurant.update({ where: { id: request.params.id }, data: parsed.data, select: { id: true, vertical: true, pickupEnabled: true } })
      await prisma.auditLog.create({ data: { actorId: request.user.id, action: 'SET_STORE_SECTION', entityType: 'Restaurant', entityId: restaurant.id, metadata: parsed.data } })
      return response.json({ restaurant })
    } catch { return response.status(404).json({ error: 'RESTAURANT_NOT_FOUND' }) }
  })

  return router
}
