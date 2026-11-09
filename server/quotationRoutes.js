import { Router } from 'express'
import { z } from 'zod'
import { QUOTE_STATUS_TEXT, QuoteError, REASON_TEXT } from './deliveryAssessment.js'
import { cancelQuote, keepPrice, respondToQuote, sendOffer } from './quotationService.js'
import { answerCheck, askRiders, checkRiderChoice, openChecksForRider, riderPricesFor } from './riderPriceChecks.js'

// Delivery price quotations: customers see and answer their own; admins manage all of them; businesses see the
// status for their own orders. Every change goes through quotationService (transactions, history, notifications).

const OPEN = ['PENDING_REVIEW', 'CUSTOMER_REVIEW_REQUESTED', 'QUOTE_EXPIRED']
const WITH_CUSTOMER = ['QUOTE_SENT', 'QUOTE_REVISED']
const text = (max) => z.string().trim().max(max)

const fail = (response, error) => {
  if (error instanceof QuoteError) return response.status(error.status).json({ error: error.code, message: error.message })
  console.error('[quotes]', error?.message)
  return response.status(503).json({ error: 'QUOTE_SERVICE_UNAVAILABLE', message: 'Delivery prices are unavailable right now. Please try again.' })
}

/** What the customer may see: no internal notes, no who-proposed ids. */
function customerView(quote) {
  if (!quote) return null
  const current = quote.versions.find((version) => version.version === quote.currentVersion) || null
  return {
    status: quote.status,
    statusText: QUOTE_STATUS_TEXT[quote.status],
    reasons: quote.reasons.map((code) => REASON_TEXT[code]).filter(Boolean),
    currentVersion: quote.currentVersion,
    reviewRounds: quote.reviewRounds,
    current: current ? { version: current.version, feeMinor: current.feeMinor, explanation: current.explanation, expiresAt: current.expiresAt, sentAt: current.createdAt, status: current.status } : null,
    history: quote.versions.map((version) => ({ version: version.version, feeMinor: version.feeMinor, explanation: version.explanation, status: version.status, sentAt: version.createdAt, customerResponse: version.customerResponse, customerMessage: version.customerMessage, respondedAt: version.respondedAt })),
    acceptedFeeMinor: quote.acceptedFeeMinor,
  }
}

export function createQuotationRouter({ prisma, requireUser, requireAdmin, maxRoundsOf = async () => 3 }) {
  const router = Router()

  /* ------------------------------ customer ------------------------------ */
  router.get('/orders/:orderId/delivery-quote', requireUser, async (request, response) => {
    try {
      const order = await prisma.order.findFirst({ where: { id: request.params.orderId, customerId: request.user.id }, select: { id: true, status: true, subtotalMinor: true, serviceFeeMinor: true, tipMinor: true, discountMinor: true, deliveryQuotation: { include: { versions: { orderBy: { version: 'asc' } } } } } })
      if (!order) return response.status(404).json({ error: 'ORDER_NOT_FOUND' })
      const maxRounds = await maxRoundsOf()
      const quote = customerView(order.deliveryQuotation)
      return response.json({ quote: quote && { ...quote, canRequestReview: false }, order: { status: order.status, subtotalMinor: order.subtotalMinor, serviceFeeMinor: order.serviceFeeMinor, tipMinor: order.tipMinor, discountMinor: order.discountMinor } })
    } catch (error) { return fail(response, error) }
  })

  const answerSchema = z.object({ action: z.enum(['ACCEPT', 'DECLINE']), version: z.number().int().min(1), message: text(500).optional() }).strict()
  router.post('/orders/:orderId/delivery-quote/respond', requireUser, async (request, response) => {
    if (request.user.role !== 'CUSTOMER') return response.status(403).json({ error: 'CUSTOMER_ROLE_REQUIRED' })
    const parsed = answerSchema.safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_ANSWER', message: 'Choose accept, decline or review.' })
    try { return response.json(await respondToQuote(prisma, request.params.orderId, request.user, parsed.data)) } catch (error) { return fail(response, error) }
  })

  /* ------------------------------ business (Store Kit) ------------------------------ */
  router.get('/restaurant/delivery-quotes', requireUser, async (request, response) => {
    if (request.user.role !== 'RESTAURANT') return response.status(403).json({ error: 'RESTAURANT_ROLE_REQUIRED' })
    try {
      const member = await prisma.restaurantUser.findFirst({ where: { userId: request.user.id }, select: { restaurantId: true } })
      if (!member) return response.status(404).json({ error: 'RESTAURANT_NOT_FOUND' })
      const rows = await prisma.deliveryQuotation.findMany({ where: { order: { restaurantId: member.restaurantId }, updatedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }, orderBy: { updatedAt: 'desc' }, take: 30, select: { status: true, acceptedFeeMinor: true, updatedAt: true, order: { select: { orderNumber: true, status: true, subtotalMinor: true, deliveryFeeMinor: true } } } })
      return response.json({ quotes: rows.map((row) => ({ orderNumber: row.order.orderNumber, orderStatus: row.order.status, status: row.status, statusText: QUOTE_STATUS_TEXT[row.status], deliveryFeeMinor: row.status === 'QUOTE_ACCEPTED' ? row.acceptedFeeMinor : null, subtotalMinor: row.order.subtotalMinor, updatedAt: row.updatedAt })) })
    } catch (error) { return fail(response, error) }
  })

  /* ------------------------------ admin ------------------------------ */
  router.get('/admin/delivery-quotes', requireUser, requireAdmin, async (request, response) => {
    const tab = String(request.query.tab || 'todo')
    const q = String(request.query.q || '').trim().slice(0, 60)
    const page = Math.max(0, Number(request.query.page) || 0)
    const statusFilter = tab === 'todo' ? OPEN : tab === 'customer' ? WITH_CUSTOMER : tab === 'done' ? ['QUOTE_ACCEPTED', 'QUOTE_DECLINED', 'QUOTE_CANCELLED'] : undefined
    const where = { ...(statusFilter ? { status: { in: statusFilter } } : {}), ...(q ? { order: { OR: [{ orderNumber: { contains: q, mode: 'insensitive' } }, { addressSnapshot: { contains: q, mode: 'insensitive' } }, { customer: { OR: [{ firstName: { contains: q, mode: 'insensitive' } }, { lastName: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }] } }] } } : {}) }
    try {
      const [rows, total, counts] = await Promise.all([
        prisma.deliveryQuotation.findMany({ where, orderBy: { updatedAt: tab === 'todo' ? 'asc' : 'desc' }, skip: page * 25, take: 25, include: { versions: { orderBy: { version: 'desc' }, take: 1 }, order: { select: { id: true, orderNumber: true, addressSnapshot: true, landmarkSnapshot: true, subtotalMinor: true, createdAt: true, locationConfidence: true, customer: { select: { firstName: true, lastName: true, phone: true } }, restaurant: { select: { name: true } } } } } }),
        prisma.deliveryQuotation.count({ where }),
        prisma.deliveryQuotation.groupBy({ by: ['status'], _count: { _all: true } }),
      ])
      const byStatus = Object.fromEntries(counts.map((row) => [row.status, row._count._all]))
      return response.json({
        page, total, pageSize: 25,
        counts: { todo: OPEN.reduce((sum, key) => sum + (byStatus[key] || 0), 0), customer: WITH_CUSTOMER.reduce((sum, key) => sum + (byStatus[key] || 0), 0), byStatus },
        quotes: rows.map((row) => ({ id: row.id, status: row.status, reasons: row.reasons, estimateFeeMinor: row.estimateFeeMinor, latestFeeMinor: row.versions[0]?.feeMinor ?? null, expiresAt: row.expiresAt, reviewRounds: row.reviewRounds, updatedAt: row.updatedAt, order: { ...row.order, customer: `${row.order.customer?.firstName || ''} ${row.order.customer?.lastName || ''}`.trim(), phone: row.order.customer?.phone || null, store: row.order.restaurant?.name } })),
      })
    } catch (error) { return fail(response, error) }
  })

  router.get('/admin/delivery-quotes/:id', requireUser, requireAdmin, async (request, response) => {
    try {
      const quote = await prisma.deliveryQuotation.findUnique({ where: { id: request.params.id }, include: {
        versions: { orderBy: { version: 'asc' } },
        events: { orderBy: { createdAt: 'asc' } },
        order: { select: { id: true, orderNumber: true, status: true, addressSnapshot: true, landmarkSnapshot: true, latitude: true, longitude: true, subtotalMinor: true, serviceFeeMinor: true, tipMinor: true, discountMinor: true, deliveryQuote: true, createdAt: true, distanceStatus: true, locationConfidence: true, customer: { select: { firstName: true, lastName: true, phone: true, email: true } }, restaurant: { select: { name: true, address: true, latitude: true, longitude: true, phone: true } }, payment: { select: { method: true, status: true } } } },
      } })
      if (!quote) return response.status(404).json({ error: 'QUOTE_NOT_FOUND' })
      const actorIds = [...new Set([...quote.events.map((event) => event.actorId), ...quote.versions.map((version) => version.proposedById)].filter(Boolean))]
      const people = await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, firstName: true, lastName: true, role: true } })
      const nameOf = Object.fromEntries(people.map((person) => [person.id, `${person.firstName || ''} ${person.lastName || ''}`.trim() || person.role]))
      return response.json({ quote: { ...quote, reasonsText: quote.reasons.map((code) => REASON_TEXT[code]).filter(Boolean), correctedDistanceKm: quote.correctedDistanceKm == null ? null : Number(quote.correctedDistanceKm), versions: quote.versions.map((version) => ({ ...version, proposedBy: nameOf[version.proposedById] || 'Admin' })), events: quote.events.map((event) => ({ ...event, actor: event.actorId ? nameOf[event.actorId] || event.actorRole : event.actorRole })) } })
    } catch (error) { return fail(response, error) }
  })

  const offerSchema = z.object({
    feeMinor: z.number().int().min(0).max(100_000_000),
    explanation: text(400).optional(),
    internalNote: text(1000).optional(),
    expiresInHours: z.number().int().min(1).max(168).optional(),
    pricingMethod: z.enum(['MANUAL_QUOTE', 'NEGOTIATED', 'FREE_DELIVERY']).default('MANUAL_QUOTE'),
    correctedDistanceKm: z.number().min(0).max(500).optional(),
    correctionReason: text(300).optional(),
    // What the rider is paid at this price (set with riders, never by the customer), and the rider who agreed it.
    riderPayMinor: z.number().int().min(0).max(5_000_000).optional(),
    agreedRiderId: z.string().min(1).max(40).optional(),
  }).strict().refine((value) => value.correctedDistanceKm == null || Boolean(value.correctionReason), { message: 'Say why the distance was corrected.' })
  router.post('/admin/delivery-quotes/:id/offer', requireUser, requireAdmin, async (request, response) => {
    const parsed = offerSchema.safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_OFFER', message: parsed.error.issues[0]?.message || 'Check the price.' })
    const input = parsed.data.pricingMethod === 'FREE_DELIVERY' ? { ...parsed.data, feeMinor: 0 } : parsed.data
    try {
      await checkRiderChoice(prisma, request.params.id, input)
      return response.json(await sendOffer(prisma, request.params.id, request.user, input))
    } catch (error) { return fail(response, error) }
  })

  /* ---------- price checks: admin ↔ riders ---------- */
  router.post('/admin/delivery-quotes/:id/ask-riders', requireUser, requireAdmin, async (request, response) => {
    const parsed = z.object({ suggestedPayMinor: z.number().int().min(0).max(5_000_000).optional(), note: text(200).optional() }).strict().safeParse(request.body || {})
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_REQUEST', message: 'Check the suggested rider pay.' })
    try { return response.json(await askRiders(prisma, request.params.id, request.user, { suggestedPayMinor: parsed.data.suggestedPayMinor ?? null, note: parsed.data.note || null })) } catch (error) { return fail(response, error) }
  })
  router.get('/admin/delivery-quotes/:id/rider-prices', requireUser, requireAdmin, async (request, response) => {
    try { return response.json({ prices: await riderPricesFor(prisma, request.params.id) }) } catch (error) { return fail(response, error) }
  })
  router.get('/rider/price-checks', requireUser, async (request, response) => {
    if (request.user.role !== 'RIDER' || !request.user.rider) return response.status(403).json({ error: 'RIDERS_ONLY' })
    try { return response.json({ checks: await openChecksForRider(prisma, request.user.rider) }) } catch (error) { return fail(response, error) }
  })
  router.post('/rider/price-checks/:id', requireUser, async (request, response) => {
    if (request.user.role !== 'RIDER' || !request.user.rider) return response.status(403).json({ error: 'RIDERS_ONLY' })
    const parsed = z.object({ response: z.enum(['AGREE', 'COUNTER', 'DECLINE']), amountMinor: z.number().int().optional(), note: text(200).optional() }).strict().safeParse(request.body || {})
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_ANSWER', message: 'Choose an answer.' })
    try {
      const saved = await answerCheck(prisma, { ...request.user.rider, userId: request.user.id }, request.params.id, parsed.data)
      return response.json({ answer: { response: saved.response, amountMinor: saved.amountMinor, note: saved.note } })
    } catch (error) { return fail(response, error) }
  })

  router.post('/admin/delivery-quotes/:id/keep', requireUser, requireAdmin, async (request, response) => {
    const parsed = z.object({ message: text(400).min(3) }).strict().safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'MESSAGE_REQUIRED', message: 'Explain to the customer why the price stays the same.' })
    try { return response.json(await keepPrice(prisma, request.params.id, request.user, parsed.data.message)) } catch (error) { return fail(response, error) }
  })

  router.post('/admin/delivery-quotes/:id/cancel', requireUser, requireAdmin, async (request, response) => {
    const parsed = z.object({ reason: text(300).min(3) }).strict().safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'REASON_REQUIRED', message: 'Give the customer a short reason.' })
    try { return response.json(await cancelQuote(prisma, request.params.id, request.user, parsed.data.reason)) } catch (error) { return fail(response, error) }
  })

  // Overview numbers for the last N days (default 30): automatic vs manual prices, quotes and outcomes, revenue.
  router.get('/admin/delivery-quotes-summary', requireUser, requireAdmin, async (request, response) => {
    const days = Math.min(365, Math.max(1, Number(request.query.days) || 30))
    const since = new Date(Date.now() - days * 86_400_000)
    try {
      const paid = ['PAID', 'RESTAURANT_ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'RIDER_ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED']
      const [byMethod, paidAgg, quoteCounts, corrected] = await Promise.all([
        prisma.order.groupBy({ by: ['deliveryPricingMethod'], where: { createdAt: { gte: since }, orderType: 'DELIVERY' }, _count: { _all: true } }),
        prisma.order.aggregate({ where: { createdAt: { gte: since }, orderType: 'DELIVERY', status: { in: paid } }, _sum: { deliveryFeeMinor: true }, _avg: { deliveryFeeMinor: true }, _count: { _all: true } }),
        prisma.deliveryQuotation.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
        prisma.deliveryQuotation.count({ where: { createdAt: { gte: since }, correctedDistanceKm: { not: null } } }),
      ])
      const methods = Object.fromEntries(byMethod.map((row) => [row.deliveryPricingMethod || 'UNRECORDED', row._count._all]))
      const quotes = Object.fromEntries(quoteCounts.map((row) => [row.status, row._count._all]))
      const answered = (quotes.QUOTE_ACCEPTED || 0) + (quotes.QUOTE_DECLINED || 0)
      return response.json({ days, deliveryOrders: Object.values(methods).reduce((sum, value) => sum + value, 0), methods, automatic: ['DISTANCE', 'AREA_FIXED', 'ROUTE_RULE', 'FREE_THRESHOLD', 'FLAT'].reduce((sum, key) => sum + (methods[key] || 0), 0), manual: methods.MANUAL_QUOTE || 0, quotes, pendingReview: (quotes.PENDING_REVIEW || 0) + (quotes.CUSTOMER_REVIEW_REQUESTED || 0), awaitingCustomer: (quotes.QUOTE_SENT || 0) + (quotes.QUOTE_REVISED || 0), acceptanceRate: answered ? Math.round((quotes.QUOTE_ACCEPTED || 0) / answered * 100) : null, paidDeliveries: paidAgg._count._all, deliveryRevenueMinor: paidAgg._sum.deliveryFeeMinor || 0, averageFeeMinor: Math.round(paidAgg._avg.deliveryFeeMinor || 0), corrections: corrected })
    } catch (error) { return fail(response, error) }
  })

  return router
}
