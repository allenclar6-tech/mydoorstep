import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import {
  activeParcelStatuses, customerCancellableStatuses, editableStatuses, fetchRoadRoutes, getParcelPricing, haversineMeters,
  PARCEL_PRICING_KEY, parcelPricingSchema, parcelReference, parcelStatusLabels, ParcelError, PAYSTACK_PENDING_TTL_MS,
  pointSchema, publicParcelServices, quoteParcel, RIDER_AVAILABILITY_LOCATION_MAX_AGE_MS, RIDER_REQUEST_TTL_MS, routingConfigured,
} from './parcelService.js'
import { initializePayment, PaymentError, paystackMode, verifyPaystackTransaction } from './paymentService.js'
import { activeLocationStatuses, claimDelivery, rejectDeliveryRequest, releaseDelivery } from './deliveryService.js'
import { notifyAdmins } from './notify.js'

const phone = z.string().trim().regex(/^\+?[0-9][0-9 ()-]{6,19}$/, 'Enter a valid phone number')
const text = (max) => z.string().trim().min(1).max(max)
const optionalText = (max) => z.string().trim().max(max).optional().transform((value) => value || null)
const packageSizes = ['SMALL', 'MEDIUM', 'LARGE']

const quoteSchema = z.object({
  pickup: pointSchema,
  dropoff: pointSchema,
  serviceCode: z.string().trim().min(2).max(24),
  packageSize: z.enum(packageSizes).optional(),
}).strict()

export const parcelBookingSchema = z.object({
  serviceCode: z.string().trim().min(2).max(24),
  routeId: z.string().regex(/^[0-2]$/),
  expectedTotalMinor: z.number().int().positive(),
  paymentMethod: z.enum(['PAYSTACK', 'BANK_TRANSFER']),
  pickup: pointSchema.extend({ address: text(300), contactName: text(120), contactPhone: phone, notes: optionalText(500) }),
  dropoff: pointSchema.extend({ address: text(300) }),
  recipient: z.object({ name: text(120), phone }),
  package: z.object({ description: text(300), size: z.enum(packageSizes) }),
  instructions: optionalText(500),
}).strict()

const editSchema = z.object({
  pickup: z.object({ contactName: text(120).optional(), contactPhone: phone.optional(), notes: optionalText(500) }).strict().optional(),
  recipient: z.object({ name: text(120).optional(), phone: phone.optional() }).strict().optional(),
  package: z.object({ description: text(300).optional() }).strict().optional(),
  instructions: optionalText(500),
}).strict()

const errorBody = (error) => ({ error: error.code || 'PARCEL_SERVICE_UNAVAILABLE', message: error.message, ...(error.field ? { field: error.field } : {}) })
const fail = (response, error, fallback = 'PARCEL_SERVICE_UNAVAILABLE') => {
  if (error instanceof ParcelError || error instanceof PaymentError || (error?.code && error?.status)) return response.status(error.status || 503).json(errorBody(error))
  console.error('[parcel] unexpected_failure', JSON.stringify({ name: error?.name, code: error?.code }))
  return response.status(503).json({ error: fallback })
}

function decimal(value) { return value == null ? null : Number(value) }

function startOfLagosDay(now = new Date()) {
  // Africa/Lagos is UTC+1 all year (no daylight saving).
  const shifted = new Date(now.getTime() + 60 * 60 * 1000)
  shifted.setUTCHours(0, 0, 0, 0)
  return new Date(shifted.getTime() - 60 * 60 * 1000)
}

/** Serializes a booking for the person viewing it; precise contact data is limited to those who need it. */
export function serializeParcel(booking, viewer) {
  const delivery = booking.delivery
  const deliveryActive = delivery ? activeLocationStatuses.has(delivery.status) : false
  const isOwner = viewer.role === 'CUSTOMER' && viewer.id === booking.customerId
  const isAssignedRider = viewer.role === 'RIDER' && viewer.rider?.id && viewer.rider.id === booking.riderId
  const isAdmin = viewer.role === 'ADMIN'
  const showContacts = isOwner || isAdmin || (isAssignedRider && deliveryActive)
  const rider = booking.rider
  return {
    id: booking.id,
    reference: booking.reference,
    status: booking.status,
    statusLabel: parcelStatusLabels[booking.status],
    service: { code: booking.serviceCode, name: booking.serviceName },
    pickup: { address: booking.pickupAddress, latitude: decimal(booking.pickupLatitude), longitude: decimal(booking.pickupLongitude), ...(showContacts ? { contactName: booking.pickupContactName, contactPhone: booking.pickupContactPhone, notes: booking.pickupNotes } : {}) },
    dropoff: { address: booking.dropoffAddress, latitude: decimal(booking.dropoffLatitude), longitude: decimal(booking.dropoffLongitude) },
    recipient: showContacts ? { name: booking.recipientName, phone: booking.recipientPhone } : null,
    package: { description: booking.packageDescription, size: booking.packageSize },
    instructions: showContacts ? booking.deliveryInstructions : null,
    route: { distanceMeters: booking.distanceMeters, durationSeconds: booking.durationSeconds, geometry: booking.routeGeometry, provider: booking.routeProvider },
    price: { baseFeeMinor: booking.baseFeeMinor, distanceFeeMinor: booking.distanceFeeMinor, minimumFareAdjustmentMinor: booking.minimumFareAdjustmentMinor, serviceFeeMinor: booking.serviceFeeMinor, totalMinor: booking.totalMinor, currency: booking.currency },
    payment: booking.payment && (isOwner || isAdmin) ? { method: booking.payment.method, status: booking.payment.status, reference: booking.payment.reference, expiresAt: booking.payment.expiresAt, instructions: booking.payment.method === 'BANK_TRANSFER' ? booking.payment.instructionsSnapshot : null } : null,
    delivery: delivery ? { id: delivery.id, status: delivery.status, active: deliveryActive, requestPending: delivery.status === 'REQUESTED' && delivery.requestExpiresAt > new Date(), requestExpiresAt: delivery.requestExpiresAt } : null,
    rider: rider ? { firstName: rider.user?.firstName || 'Rider', vehicleType: rider.vehicleType, rating: rider.ratingCount > 0 ? { average: Number(rider.ratingAverage), count: rider.ratingCount } : null, ...(deliveryActive && (isOwner || isAdmin) && rider.user?.phone ? { phone: rider.user.phone } : {}) } : null,
    riderRating: booking.riderRating,
    events: (booking.events || []).map((event) => ({ status: event.status, label: parcelStatusLabels[event.status], note: event.note, actorRole: event.actorRole, createdAt: event.createdAt })),
    permissions: isOwner ? {
      canCancel: customerCancellableStatuses.has(booking.status),
      canEdit: editableStatuses.has(booking.status),
      canPay: booking.status === 'PENDING_PAYMENT',
      canRequestRider: booking.status === 'SEARCHING_FOR_RIDER',
      canRate: booking.status === 'DELIVERED' && booking.riderRating == null && Boolean(booking.riderId),
    } : {},
    timestamps: { createdAt: booking.createdAt, paidAt: booking.paidAt, assignedAt: booking.assignedAt, pickedUpAt: booking.pickedUpAt, deliveredAt: booking.deliveredAt, cancelledAt: booking.cancelledAt },
    cancellationReason: booking.cancellationReason,
  }
}

const bookingInclude = {
  delivery: true,
  payment: true,
  events: { orderBy: { createdAt: 'asc' } },
  rider: { select: { id: true, vehicleType: true, ratingAverage: true, ratingCount: true, user: { select: { firstName: true, phone: true } } } },
}

/**
 * Applies a provider-verified successful payment to a parcel booking inside a database transaction.
 * Safe to call from both the webhook and the verify endpoint: the conditional update makes it idempotent.
 */
export async function confirmParcelPayment(transaction, payment, { providerReference, providerTransactionId = null, source, metadata = null }) {
  const changed = await transaction.payment.updateMany({ where: { id: payment.id, status: { not: 'SUCCESSFUL' } }, data: { status: 'SUCCESSFUL', verifiedAt: new Date(), providerTransactionId: providerTransactionId ? String(providerTransactionId) : undefined } })
  if (changed.count !== 1) {
    if (providerReference && providerReference !== payment.reference) {
      // A second, older attempt was also paid. Never silently keep the money.
      await transaction.transaction.create({ data: { paymentId: payment.id, type: 'DUPLICATE_PAYMENT_REFUND_REQUIRED', amountMinor: payment.amountMinor, providerReference, metadata: { source } } })
    }
    return { duplicate: true }
  }
  const booking = await transaction.parcelBooking.findUnique({ where: { id: payment.parcelBookingId } })
  await transaction.transaction.create({ data: { paymentId: payment.id, type: 'PAYMENT_SUCCESS', amountMinor: payment.amountMinor, providerReference: providerReference || payment.reference, metadata: metadata ? { source, ...metadata } : { source } } })
  if (booking.status !== 'PENDING_PAYMENT') {
    await transaction.transaction.create({ data: { paymentId: payment.id, type: 'REFUND_REQUIRED', amountMinor: payment.amountMinor, providerReference: providerReference || payment.reference, metadata: { reason: `Payment arrived while booking was ${booking.status}` } } })
    return { refundRequired: true }
  }
  const now = new Date()
  await transaction.parcelBooking.update({ where: { id: booking.id }, data: { status: 'SEARCHING_FOR_RIDER', paidAt: now } })
  await transaction.parcelEvent.create({ data: { bookingId: booking.id, status: 'PAYMENT_CONFIRMED', actorRole: 'SYSTEM', note: `Verified by ${source}` } })
  await transaction.parcelEvent.create({ data: { bookingId: booking.id, status: 'SEARCHING_FOR_RIDER', actorRole: 'SYSTEM' } })
  await transaction.delivery.upsert({ where: { parcelBookingId: booking.id }, update: {}, create: { parcelBookingId: booking.id, status: 'AVAILABLE', requestedAt: now } })
  await transaction.notification.create({ data: { userId: booking.customerId, type: 'PAYMENT', title: 'Payment confirmed', body: `Payment for ${booking.reference} was confirmed. Choose a rider or wait for the next available rider.`, link: `/parcels/${booking.id}` } })
  const riders = await transaction.rider.findMany({ where: { status: 'APPROVED', availability: 'ONLINE', network: 'DOORSTEP_POOL' }, select: { userId: true }, take: 25 })
  if (riders.length) await transaction.notification.createMany({ data: riders.map((rider) => ({ userId: rider.userId, type: 'DELIVERY', title: 'New package delivery available', body: `A ${booking.packageSize.toLowerCase()} package delivery (${(booking.distanceMeters / 1000).toFixed(1)} km by road) is waiting for a rider.`, link: '/rider/dashboard' })) })
  return { confirmed: true, bookingId: booking.id }
}

export function createParcelRouter({ prisma, requireUser, requireAdmin, getPaymentSettings, hasValidBankTransferConfig, realtime, fetchImpl = (...args) => globalThis.fetch(...args) }) {
  const router = Router()
  const quoteLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, handler: (_request, response) => response.status(429).json({ error: 'QUOTE_RATE_LIMITED', message: 'Too many price checks. Wait a minute and try again.' }) })
  const requireCustomer = (request, response, next) => request.user.role === 'CUSTOMER' ? next() : response.status(403).json({ error: 'CUSTOMER_ROLE_REQUIRED' })
  const requireRider = (request, response, next) => request.user.role === 'RIDER' && request.user.rider ? next() : response.status(403).json({ error: 'RIDER_ROLE_REQUIRED' })
  const loadOwned = async (request) => {
    const booking = await prisma.parcelBooking.findFirst({ where: { id: request.params.bookingId, customerId: request.user.id }, include: bookingInclude })
    if (!booking) throw new ParcelError('PARCEL_NOT_FOUND', 'Booking not found.', 404)
    return booking
  }
  const bankTransferAvailable = (settings) => Boolean(settings.bankTransfer.enabled && hasValidBankTransferConfig(settings.bankTransfer))

  router.get('/parcels/config', async (_request, response) => {
    try {
      const [pricing, paymentSettings] = await Promise.all([getParcelPricing(prisma), getPaymentSettings()])
      return response.json({
        enabled: pricing.enabled && !pricing.invalidStoredSettings && routingConfigured(),
        reason: pricing.invalidStoredSettings ? 'PRICING_INVALID' : !pricing.enabled ? 'PRICING_NOT_PUBLISHED' : !routingConfigured() ? 'ROUTING_NOT_CONFIGURED' : null,
        currency: pricing.currency,
        services: publicParcelServices(pricing),
        serviceFee: pricing.serviceFee,
        serviceArea: pricing.serviceArea,
        maxRouteDistanceKm: pricing.maxRouteDistanceKm,
        payments: { paystack: { enabled: Boolean(process.env.PAYSTACK_SECRET_KEY), mode: paystackMode() }, bankTransfer: { enabled: bankTransferAvailable(paymentSettings) } },
      })
    } catch (error) { return fail(response, error, 'PARCEL_CONFIGURATION_UNAVAILABLE') }
  })

  // ------------------------------ admin -----------------------------------
  router.get('/admin/parcel-pricing', requireUser, requireAdmin, async (_request, response) => {
    try { return response.json({ pricing: await getParcelPricing(prisma), routingConfigured: routingConfigured() }) } catch (error) { return fail(response, error) }
  })

  router.patch('/admin/parcel-pricing', requireUser, requireAdmin, async (request, response) => {
    const result = parcelPricingSchema.safeParse(request.body)
    if (!result.success) return response.status(400).json({ error: 'INVALID_PARCEL_PRICING', message: result.error.issues.map((issue) => issue.message).join(' '), details: result.error.flatten() })
    try {
      const value = { ...result.data, approvedBy: `${request.user.firstName} ${request.user.lastName}`.trim() }
      const saved = await prisma.$transaction(async (transaction) => {
        const setting = await transaction.platformSetting.upsert({ where: { key: PARCEL_PRICING_KEY }, update: { value }, create: { key: PARCEL_PRICING_KEY, value } })
        await transaction.auditLog.create({ data: { actorId: request.user.id, action: 'UPDATE_PARCEL_PRICING', entityType: 'PlatformSetting', entityId: setting.id, metadata: { enabled: value.enabled, services: value.services.map(({ code, enabled, baseFeeMinor, perKmMinor, minimumFareMinor }) => ({ code, enabled, baseFeeMinor, perKmMinor, minimumFareMinor })), serviceFee: value.serviceFee } } })
        return setting.value
      })
      return response.json({ pricing: saved, routingConfigured: routingConfigured() })
    } catch (error) { return fail(response, error) }
  })

  router.get('/admin/parcels', requireUser, requireAdmin, async (request, response) => {
    const status = z.enum(Object.keys(parcelStatusLabels)).optional().safeParse(request.query.status)
    if (!status.success) return response.status(400).json({ error: 'INVALID_PARCEL_FILTER' })
    try {
      const bookings = await prisma.parcelBooking.findMany({ where: status.data ? { status: status.data } : {}, include: { ...bookingInclude, customer: { select: { firstName: true, lastName: true, email: true } } }, orderBy: { createdAt: 'desc' }, take: 100 })
      return response.json({ bookings: bookings.map((booking) => ({ ...serializeParcel(booking, request.user), customer: booking.customer })) })
    } catch (error) { return fail(response, error) }
  })

  // ----------------------------- customer ---------------------------------
  router.post('/parcels/quote', requireUser, requireCustomer, quoteLimiter, async (request, response) => {
    const result = quoteSchema.safeParse(request.body)
    if (!result.success) return response.status(400).json({ error: 'INVALID_QUOTE_REQUEST', details: result.error.flatten() })
    try {
      const quote = await quoteParcel({ prisma, ...result.data, fetchImpl })
      return response.json({ service: quote.service, currency: quote.currency, routes: quote.routes, disclaimer: quote.disclaimer })
    } catch (error) { return fail(response, error) }
  })

  router.post('/parcels', requireUser, requireCustomer, quoteLimiter, async (request, response) => {
    const result = parcelBookingSchema.safeParse(request.body)
    if (!result.success) return response.status(400).json({ error: 'INVALID_PARCEL_BOOKING', message: 'Check the highlighted booking details.', details: result.error.flatten() })
    const idempotencyKey = request.get('idempotency-key') || null
    if (idempotencyKey && (idempotencyKey.length < 16 || idempotencyKey.length > 120)) return response.status(400).json({ error: 'INVALID_IDEMPOTENCY_KEY' })
    const input = result.data
    try {
      if (idempotencyKey) {
        const existing = await prisma.parcelBooking.findUnique({ where: { idempotencyKey }, include: bookingInclude })
        if (existing) return existing.customerId === request.user.id ? response.status(200).json({ booking: serializeParcel(existing, request.user), duplicate: true }) : response.status(409).json({ error: 'IDEMPOTENCY_KEY_CONFLICT' })
      }
      const paymentSettings = await getPaymentSettings()
      if (input.paymentMethod === 'BANK_TRANSFER' && !bankTransferAvailable(paymentSettings)) return response.status(409).json({ error: 'BANK_TRANSFER_UNAVAILABLE', message: 'Bank transfer is not available right now.' })
      if (input.paymentMethod === 'PAYSTACK' && !process.env.PAYSTACK_SECRET_KEY) return response.status(503).json({ error: 'PAYMENT_PROVIDER_NOT_CONFIGURED', message: 'Card payment is not configured. Choose another payment method.' })
      // Price is recomputed from a fresh server-side road route; the browser's figures are only used to detect changes.
      const quote = await quoteParcel({ prisma, pickup: input.pickup, dropoff: input.dropoff, serviceCode: input.serviceCode, packageSize: input.package.size, fetchImpl })
      const route = quote.routes.find((item) => item.id === input.routeId) || null
      if (!route || route.price.totalMinor !== input.expectedTotalMinor) {
        return response.status(409).json({ error: 'PRICE_CHANGED', message: 'The route or price changed since you last checked. Review the updated price before confirming.', quote: { service: quote.service, currency: quote.currency, routes: quote.routes } })
      }
      const booking = await prisma.$transaction(async (transaction) => {
        const reference = parcelReference()
        const transferExpiry = input.paymentMethod === 'BANK_TRANSFER' && paymentSettings.bankTransfer.expiryMinutes ? new Date(Date.now() + paymentSettings.bankTransfer.expiryMinutes * 60_000) : null
        const created = await transaction.parcelBooking.create({
          data: {
            reference, idempotencyKey, customerId: request.user.id,
            serviceCode: quote.service.code, serviceName: quote.service.name,
            pickupAddress: input.pickup.address, pickupLatitude: input.pickup.latitude, pickupLongitude: input.pickup.longitude,
            pickupContactName: input.pickup.contactName, pickupContactPhone: input.pickup.contactPhone, pickupNotes: input.pickup.notes,
            dropoffAddress: input.dropoff.address, dropoffLatitude: input.dropoff.latitude, dropoffLongitude: input.dropoff.longitude,
            recipientName: input.recipient.name, recipientPhone: input.recipient.phone,
            packageDescription: input.package.description, packageSize: input.package.size, deliveryInstructions: input.instructions,
            distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds, routeGeometry: route.geometry, routeProvider: route.provider,
            baseFeeMinor: route.price.baseFeeMinor, distanceFeeMinor: route.price.distanceFeeMinor, minimumFareAdjustmentMinor: route.price.minimumFareAdjustmentMinor,
            serviceFeeMinor: route.price.serviceFeeMinor, totalMinor: route.price.totalMinor, currency: route.price.currency,
            pricingSnapshot: quote.pricingSnapshot,
            payment: { create: {
              provider: input.paymentMethod === 'PAYSTACK' ? 'paystack' : 'doorstep',
              method: input.paymentMethod,
              reference: input.paymentMethod === 'BANK_TRANSFER' ? `DSPTRF-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}` : `DSPPKG-${randomUUID()}`,
              amountMinor: route.price.totalMinor,
              status: input.paymentMethod === 'BANK_TRANSFER' ? 'PENDING_VERIFICATION' : 'PENDING',
              expiresAt: transferExpiry,
              verificationMethod: input.paymentMethod === 'BANK_TRANSFER' ? 'MANUAL' : 'PROVIDER',
              instructionsSnapshot: input.paymentMethod === 'BANK_TRANSFER' ? { bankName: paymentSettings.bankTransfer.bankName, accountName: paymentSettings.bankTransfer.accountName, accountNumber: paymentSettings.bankTransfer.accountNumber, message: paymentSettings.bankTransfer.instructions } : undefined,
            } },
            events: { create: { status: 'PENDING_PAYMENT', actorId: request.user.id, actorRole: 'CUSTOMER', note: 'Booking created' } },
          },
          include: bookingInclude,
        })
        if (input.paymentMethod === 'BANK_TRANSFER') await notifyAdmins(transaction, { type: 'PAYMENT', title: 'Bank transfer to confirm', body: `Package ${created.reference} (${'₦'}${(created.totalMinor / 100).toLocaleString('en-NG')}) will be paid by bank transfer. Confirm it once the money arrives.`, link: '/admin/payments' })
        return created
      })
      return response.status(201).json({ booking: serializeParcel(booking, request.user) })
    } catch (error) {
      if (error?.code === 'P2002') return response.status(409).json({ error: 'DUPLICATE_BOOKING', message: 'This booking was already submitted.' })
      return fail(response, error)
    }
  })

  router.get('/parcels', requireUser, requireCustomer, async (request, response) => {
    const result = z.object({ cursor: z.string().min(1).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }).safeParse(request.query)
    if (!result.success) return response.status(400).json({ error: 'INVALID_PAGINATION' })
    try {
      const bookings = await prisma.parcelBooking.findMany({ where: { customerId: request.user.id }, include: bookingInclude, orderBy: { createdAt: 'desc' }, take: result.data.limit + 1, ...(result.data.cursor ? { cursor: { id: result.data.cursor }, skip: 1 } : {}) })
      const hasNextPage = bookings.length > result.data.limit
      if (hasNextPage) bookings.pop()
      return response.json({ bookings: bookings.map((booking) => serializeParcel(booking, request.user)), nextCursor: hasNextPage ? bookings.at(-1)?.id || null : null })
    } catch (error) { return fail(response, error) }
  })

  router.get('/parcels/:bookingId', requireUser, async (request, response) => {
    try {
      const booking = await prisma.parcelBooking.findUnique({ where: { id: request.params.bookingId }, include: bookingInclude })
      if (!booking) return response.status(404).json({ error: 'PARCEL_NOT_FOUND' })
      const allowed = (request.user.role === 'CUSTOMER' && booking.customerId === request.user.id)
        || (request.user.role === 'RIDER' && request.user.rider && (booking.riderId === request.user.rider.id || (booking.delivery?.status === 'REQUESTED' && booking.delivery.requestedRiderId === request.user.rider.id)))
        || request.user.role === 'ADMIN'
      if (!allowed) return response.status(404).json({ error: 'PARCEL_NOT_FOUND' })
      return response.json({ booking: serializeParcel(booking, request.user) })
    } catch (error) { return fail(response, error) }
  })

  router.patch('/parcels/:bookingId', requireUser, requireCustomer, async (request, response) => {
    const result = editSchema.safeParse(request.body)
    if (!result.success) return response.status(400).json({ error: 'INVALID_PARCEL_EDIT', details: result.error.flatten() })
    try {
      const booking = await loadOwned(request)
      if (!editableStatuses.has(booking.status)) throw new ParcelError('PARCEL_NOT_EDITABLE', 'Details can only be edited before payment. Contact support for changes after payment.', 409)
      const { pickup = {}, recipient = {}, package: pkg = {}, instructions } = result.data
      const data = {
        ...(pickup.contactName ? { pickupContactName: pickup.contactName } : {}),
        ...(pickup.contactPhone ? { pickupContactPhone: pickup.contactPhone } : {}),
        ...(pickup.notes !== undefined ? { pickupNotes: pickup.notes } : {}),
        ...(recipient.name ? { recipientName: recipient.name } : {}),
        ...(recipient.phone ? { recipientPhone: recipient.phone } : {}),
        ...(pkg.description ? { packageDescription: pkg.description } : {}),
        ...(instructions !== undefined ? { deliveryInstructions: instructions } : {}),
      }
      const changed = await prisma.parcelBooking.updateMany({ where: { id: booking.id, status: 'PENDING_PAYMENT' }, data })
      if (changed.count !== 1) throw new ParcelError('PARCEL_STATE_CHANGED', 'This booking changed. Refresh and try again.', 409)
      const updated = await prisma.parcelBooking.findUnique({ where: { id: booking.id }, include: bookingInclude })
      return response.json({ booking: serializeParcel(updated, request.user) })
    } catch (error) { return fail(response, error) }
  })

  router.post('/parcels/:bookingId/pay', requireUser, requireCustomer, async (request, response) => {
    const saveCard = request.body?.saveCard === true
    try {
      const booking = await loadOwned(request)
      const payment = booking.payment
      if (!payment) throw new ParcelError('PAYMENT_NOT_FOUND', 'Payment record not found.', 404)
      if (booking.status !== 'PENDING_PAYMENT' || payment.status === 'SUCCESSFUL') return response.json({ paid: payment.status === 'SUCCESSFUL', booking: serializeParcel(booking, request.user) })
      if (payment.method === 'BANK_TRANSFER') {
        if (payment.expiresAt && payment.expiresAt <= new Date() && payment.status === 'PENDING_VERIFICATION') {
          await prisma.payment.update({ where: { id: payment.id }, data: { status: 'EXPIRED' } })
          throw new ParcelError('PAYMENT_EXPIRED', 'These transfer instructions expired. Cancel this booking and create a new one.', 409)
        }
        return response.json({ method: 'BANK_TRANSFER', instructions: payment.instructionsSnapshot, reference: payment.reference, amountMinor: payment.amountMinor, expiresAt: payment.expiresAt })
      }
      const stored = payment.instructionsSnapshot && typeof payment.instructionsSnapshot === 'object' ? payment.instructionsSnapshot : null
      let current = payment
      if (stored?.authorizationUrl) {
        // Before handing out a checkout link again, ask Paystack what happened to the last one.
        const verified = await verifyPaystackTransaction(payment.reference, { fetchImpl })
        if (verified.status === 'success') {
          const outcome = await applyPaystackVerification(prisma, payment, verified, 'verify')
          const refreshed = await prisma.parcelBooking.findUnique({ where: { id: booking.id }, include: bookingInclude })
          return response.json({ paid: outcome.confirmed || outcome.duplicate, booking: serializeParcel(refreshed, request.user) })
        }
        const fresh = stored.initializedAt && Date.now() - new Date(stored.initializedAt).getTime() < PAYSTACK_PENDING_TTL_MS
        if (verified.status !== 'failed' && fresh) return response.json({ method: 'PAYSTACK', authorizationUrl: stored.authorizationUrl, reference: payment.reference, mode: paystackMode() })
        current = await rotatePaymentReference(prisma, payment, verified.status)
      }
      const initialized = await initializePayment({ email: request.user.email, amountMinor: current.amountMinor, reference: current.reference, callbackUrl: process.env.PAYMENT_CALLBACK_URL, metadata: { parcelBookingId: booking.id, parcelReference: booking.reference, kind: 'parcel', saveCard } })
      await prisma.payment.update({ where: { id: current.id }, data: { instructionsSnapshot: { authorizationUrl: initialized.authorizationUrl, initializedAt: new Date().toISOString() } } })
      return response.json({ method: 'PAYSTACK', authorizationUrl: initialized.authorizationUrl, reference: current.reference, mode: paystackMode() })
    } catch (error) { return fail(response, error, 'PAYMENT_SERVICE_UNAVAILABLE') }
  })

  router.post('/parcels/:bookingId/cancel', requireUser, requireCustomer, async (request, response) => {
    const result = z.object({ reason: z.string().trim().max(300).optional() }).safeParse(request.body || {})
    if (!result.success) return response.status(400).json({ error: 'INVALID_CANCELLATION' })
    try {
      const booking = await loadOwned(request)
      if (!customerCancellableStatuses.has(booking.status)) throw new ParcelError('PARCEL_NOT_CANCELLABLE', booking.status === 'CANCELLED' ? 'This booking is already cancelled.' : 'The package has already been picked up, so it can no longer be cancelled here. Contact support.', 409)
      const updated = await prisma.$transaction(async (transaction) => {
        const changed = await transaction.parcelBooking.updateMany({ where: { id: booking.id, status: booking.status }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: result.data.reason || 'Cancelled by customer', cancelledByRole: 'CUSTOMER' } })
        if (changed.count !== 1) throw new ParcelError('PARCEL_STATE_CHANGED', 'This booking changed. Refresh and try again.', 409)
        await transaction.parcelEvent.create({ data: { bookingId: booking.id, status: 'CANCELLED', actorId: request.user.id, actorRole: 'CUSTOMER', note: result.data.reason || null } })
        if (booking.delivery && booking.delivery.status !== 'DELIVERED') {
          await transaction.delivery.update({ where: { id: booking.delivery.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), requestedRiderId: null, requestExpiresAt: null } })
          const riderUserId = booking.riderId ? (await transaction.rider.findUnique({ where: { id: booking.riderId }, select: { userId: true } }))?.userId : null
          if (riderUserId) await transaction.notification.create({ data: { userId: riderUserId, type: 'DELIVERY', title: 'Delivery cancelled', body: `The customer cancelled ${booking.reference}. Do not travel to the pickup point.`, link: '/rider/dashboard' } })
        }
        if (booking.payment?.status === 'SUCCESSFUL') {
          await transaction.transaction.create({ data: { paymentId: booking.payment.id, type: 'REFUND_REQUIRED', amountMinor: booking.payment.amountMinor, providerReference: booking.payment.reference, metadata: { reason: 'Customer cancelled a paid parcel booking' } } })
          const admins = await transaction.user.findMany({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { id: true }, take: 20 })
          if (admins.length) await transaction.notification.createMany({ data: admins.map((admin) => ({ userId: admin.id, type: 'PAYMENT', title: 'Parcel refund required', body: `Paid booking ${booking.reference} was cancelled by the customer and needs a refund review.`, link: '/admin/parcels' })) })
        } else if (booking.payment && ['PENDING', 'PENDING_VERIFICATION'].includes(booking.payment.status)) {
          await transaction.payment.update({ where: { id: booking.payment.id }, data: { status: 'ABANDONED' } })
        }
        return transaction.parcelBooking.findUnique({ where: { id: booking.id }, include: bookingInclude })
      })
      if (booking.delivery) realtime?.broadcastStatus(booking.delivery.id, 'CANCELLED')
      return response.json({ booking: serializeParcel(updated, request.user), refundReview: booking.payment?.status === 'SUCCESSFUL' })
    } catch (error) { return fail(response, error) }
  })

  router.get('/parcels/:bookingId/riders', requireUser, requireCustomer, async (request, response) => {
    try {
      const booking = await loadOwned(request)
      if (booking.status !== 'SEARCHING_FOR_RIDER') return response.json({ riders: [], message: 'Rider selection is only available while DOORSTEP is searching for a rider.' })
      const pickup = { latitude: Number(booking.pickupLatitude), longitude: Number(booking.pickupLongitude) }
      const busy = await prisma.delivery.findMany({ where: { status: { in: [...activeLocationStatuses] }, riderId: { not: null } }, select: { riderId: true } })
      const busyIds = busy.map((item) => item.riderId)
      const riders = await prisma.rider.findMany({ where: { status: 'APPROVED', availability: 'ONLINE', network: 'DOORSTEP_POOL', id: { notIn: busyIds } }, select: { id: true, vehicleType: true, ratingAverage: true, ratingCount: true, availabilityLatitude: true, availabilityLongitude: true, availabilityLocatedAt: true, user: { select: { firstName: true } } }, take: 40 })
      const freshAfter = Date.now() - RIDER_AVAILABILITY_LOCATION_MAX_AGE_MS
      const located = riders
        .filter((rider) => rider.availabilityLatitude != null && rider.availabilityLocatedAt && rider.availabilityLocatedAt.getTime() >= freshAfter)
        .map((rider) => ({ rider, straight: haversineMeters({ latitude: Number(rider.availabilityLatitude), longitude: Number(rider.availabilityLongitude) }, pickup) }))
        .sort((a, b) => a.straight - b.straight)
      const etaById = new Map()
      // Road ETA for the nearest few riders only; each is one Directions request.
      await Promise.all(located.slice(0, 5).map(async ({ rider }) => {
        try {
          const [route] = await fetchRoadRoutes({ latitude: Number(rider.availabilityLatitude), longitude: Number(rider.availabilityLongitude) }, pickup, { alternatives: false, fetchImpl })
          etaById.set(rider.id, { etaSeconds: route.durationSeconds, roadDistanceMeters: route.distanceMeters })
        } catch { /* ETA stays unknown rather than guessed */ }
      }))
      const completed = await prisma.delivery.groupBy({ by: ['riderId'], where: { riderId: { in: riders.map((rider) => rider.id) }, status: 'DELIVERED' }, _count: { _all: true } }).catch(() => [])
      const completedById = new Map(completed.map((row) => [row.riderId, row._count._all]))
      const list = riders.map((rider) => ({
        id: rider.id,
        firstName: rider.user.firstName,
        vehicleType: rider.vehicleType,
        rating: rider.ratingCount > 0 ? { average: Number(rider.ratingAverage), count: rider.ratingCount } : null,
        completedDeliveries: completedById.get(rider.id) || 0,
        arrival: etaById.get(rider.id) || null,
        locationShared: located.some((item) => item.rider.id === rider.id),
      })).sort((a, b) => (a.arrival?.etaSeconds ?? Infinity) - (b.arrival?.etaSeconds ?? Infinity))
      return response.json({ riders: list, request: booking.delivery?.status === 'REQUESTED' && booking.delivery.requestExpiresAt > new Date() ? { riderId: booking.delivery.requestedRiderId, expiresAt: booking.delivery.requestExpiresAt } : null })
    } catch (error) { return fail(response, error) }
  })

  router.post('/parcels/:bookingId/request-rider', requireUser, requireCustomer, async (request, response) => {
    const result = z.object({ riderId: z.string().min(1).max(64) }).safeParse(request.body)
    if (!result.success) return response.status(400).json({ error: 'INVALID_RIDER_REQUEST' })
    try {
      const booking = await loadOwned(request)
      if (booking.status !== 'SEARCHING_FOR_RIDER' || !booking.delivery) throw new ParcelError('PARCEL_NOT_SEARCHING', 'This booking is not waiting for a rider.', 409)
      const now = new Date()
      const updated = await prisma.$transaction(async (transaction) => {
        const rider = await transaction.rider.findUnique({ where: { id: result.data.riderId }, select: { id: true, userId: true, status: true, availability: true, network: true } })
        if (!rider || rider.status !== 'APPROVED' || rider.availability !== 'ONLINE' || rider.network !== 'DOORSTEP_POOL') throw new ParcelError('RIDER_NOT_AVAILABLE', 'That rider is no longer available. Choose another rider.', 409)
        const busy = await transaction.delivery.count({ where: { riderId: rider.id, status: { in: [...activeLocationStatuses] } } })
        if (busy) throw new ParcelError('RIDER_NOT_AVAILABLE', 'That rider just started another delivery. Choose another rider.', 409)
        const changed = await transaction.delivery.updateMany({
          where: { id: booking.delivery.id, riderId: null, OR: [{ status: 'AVAILABLE' }, { status: 'REQUESTED', requestExpiresAt: { lte: now } }] },
          data: { status: 'REQUESTED', requestedRiderId: rider.id, requestExpiresAt: new Date(now.getTime() + RIDER_REQUEST_TTL_MS) },
        })
        if (changed.count !== 1) throw new ParcelError('RIDER_REQUEST_PENDING', 'A rider is already considering this delivery. Wait for their answer.', 409)
        await transaction.parcelEvent.create({ data: { bookingId: booking.id, status: 'SEARCHING_FOR_RIDER', actorId: request.user.id, actorRole: 'CUSTOMER', note: 'Customer requested a specific rider' } })
        await transaction.notification.create({ data: { userId: rider.userId, type: 'DELIVERY', title: 'Delivery request for you', body: `A customer requested you for ${booking.reference}. Respond within 2 minutes.`, link: '/rider/dashboard' } })
        return transaction.parcelBooking.findUnique({ where: { id: booking.id }, include: bookingInclude })
      })
      return response.json({ booking: serializeParcel(updated, request.user) })
    } catch (error) { return fail(response, error) }
  })

  router.post('/parcels/:bookingId/rate', requireUser, requireCustomer, async (request, response) => {
    const result = z.object({ rating: z.number().int().min(1).max(5) }).safeParse(request.body)
    if (!result.success) return response.status(400).json({ error: 'INVALID_RATING' })
    try {
      const booking = await loadOwned(request)
      if (booking.status !== 'DELIVERED' || !booking.riderId) throw new ParcelError('PARCEL_NOT_RATEABLE', 'You can rate the rider after delivery.', 409)
      await prisma.$transaction(async (transaction) => {
        const changed = await transaction.parcelBooking.updateMany({ where: { id: booking.id, riderRating: null }, data: { riderRating: result.data.rating } })
        if (changed.count !== 1) throw new ParcelError('ALREADY_RATED', 'You already rated this delivery.', 409)
        const aggregate = await transaction.parcelBooking.aggregate({ where: { riderId: booking.riderId, riderRating: { not: null } }, _avg: { riderRating: true }, _count: { riderRating: true } })
        await transaction.rider.update({ where: { id: booking.riderId }, data: { ratingAverage: aggregate._avg.riderRating || 0, ratingCount: aggregate._count.riderRating } })
      })
      const updated = await prisma.parcelBooking.findUnique({ where: { id: booking.id }, include: bookingInclude })
      return response.json({ booking: serializeParcel(updated, request.user) })
    } catch (error) { return fail(response, error) }
  })

  // ------------------------------- rider ----------------------------------
  router.get('/rider/parcel-jobs', requireUser, requireRider, async (request, response) => {
    try {
      const riderId = request.user.rider.id
      const now = new Date()
      const canTakeJobs = request.user.rider.status === 'APPROVED' && request.user.rider.network === 'DOORSTEP_POOL'
      const deliveries = await prisma.delivery.findMany({
        where: {
          parcelBookingId: { not: null },
          OR: [
            { riderId, status: { in: [...activeLocationStatuses] } },
            ...(canTakeJobs ? [
              { status: 'REQUESTED', requestedRiderId: riderId, requestExpiresAt: { gt: now } },
              { status: 'AVAILABLE' },
              { status: 'REQUESTED', requestExpiresAt: { lte: now } },
            ] : []),
          ],
        },
        include: { parcelBooking: { include: bookingInclude } },
        orderBy: { requestedAt: 'asc' },
        take: 40,
      })
      const jobs = deliveries.map((delivery) => {
        const booking = serializeParcel({ ...delivery.parcelBooking, delivery }, request.user)
        return {
          deliveryId: delivery.id,
          kind: delivery.riderId === riderId ? 'ACTIVE' : delivery.status === 'REQUESTED' && delivery.requestedRiderId === riderId && delivery.requestExpiresAt > now ? 'REQUESTED_FOR_YOU' : 'OPEN',
          status: delivery.status,
          requestExpiresAt: delivery.requestExpiresAt,
          booking,
        }
      })
      return response.json({ jobs })
    } catch (error) { return fail(response, error, 'RIDER_DELIVERY_SERVICE_UNAVAILABLE') }
  })

  router.post('/deliveries/:deliveryId/accept', requireUser, requireRider, async (request, response) => {
    try {
      const delivery = await claimDelivery(request.params.deliveryId, request.user.rider.id)
      realtime?.broadcastStatus(delivery.id, delivery.status)
      return response.json({ delivery })
    } catch (error) { return fail(response, error, 'DELIVERY_SERVICE_UNAVAILABLE') }
  })

  router.post('/deliveries/:deliveryId/reject', requireUser, requireRider, async (request, response) => {
    try { return response.json({ delivery: await rejectDeliveryRequest(request.params.deliveryId, request.user.rider.id) }) } catch (error) { return fail(response, error, 'DELIVERY_SERVICE_UNAVAILABLE') }
  })

  router.post('/deliveries/:deliveryId/release', requireUser, requireRider, async (request, response) => {
    const result = z.object({ reason: z.string().trim().max(300).optional() }).safeParse(request.body || {})
    if (!result.success) return response.status(400).json({ error: 'INVALID_RELEASE' })
    try {
      const delivery = await releaseDelivery(request.params.deliveryId, request.user.rider.id, result.data.reason)
      realtime?.broadcastStatus(delivery.id, delivery.status)
      return response.json({ delivery })
    } catch (error) { return fail(response, error, 'DELIVERY_SERVICE_UNAVAILABLE') }
  })

  router.get('/rider/summary', requireUser, requireRider, async (request, response) => {
    try {
      const riderId = request.user.rider.id
      const since = startOfLagosDay()
      const [rider, completedToday, active, completedTotal, payoutsToday] = await Promise.all([
        prisma.rider.findUnique({ where: { id: riderId }, select: { status: true, availability: true, vehicleType: true, ratingAverage: true, ratingCount: true, availabilityLocatedAt: true, availabilityChangedAt: true } }),
        prisma.delivery.count({ where: { riderId, status: 'DELIVERED', deliveredAt: { gte: since } } }),
        prisma.delivery.count({ where: { riderId, status: { in: [...activeLocationStatuses] } } }),
        prisma.delivery.count({ where: { riderId, status: 'DELIVERED' } }),
        prisma.riderPayout.aggregate({ where: { riderId, order: { deliveredAt: { gte: since } } }, _sum: { amountMinor: true } }),
      ])
      return response.json({
        availability: rider.availability,
        onlineSince: rider.availability === 'ONLINE' ? rider.availabilityChangedAt : null,
        approval: rider.status,
        vehicleType: rider.vehicleType,
        rating: rider.ratingCount > 0 ? { average: Number(rider.ratingAverage), count: rider.ratingCount } : null,
        today: { completedDeliveries: completedToday, recordedEarningsMinor: payoutsToday._sum.amountMinor || 0 },
        activeDeliveries: active,
        completedDeliveries: completedTotal,
        availabilityLocationSharedAt: rider.availabilityLocatedAt,
      })
    } catch (error) { return fail(response, error, 'RIDER_SUMMARY_UNAVAILABLE') }
  })

  const availabilityLocationTimes = new Map()
  router.put('/rider/availability-location', requireUser, requireRider, async (request, response) => {
    const result = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), accuracy: z.number().min(0).max(2000), timestamp: z.number() }).safeParse(request.body)
    if (!result.success) return response.status(400).json({ error: 'INVALID_LOCATION' })
    const riderId = request.user.rider.id
    const age = Date.now() - result.data.timestamp
    if (age > 5 * 60_000 || age < -30_000) return response.status(400).json({ error: 'STALE_LOCATION', message: 'That location reading is too old. Try again.' })
    const last = availabilityLocationTimes.get(riderId)
    if (last && Date.now() - last < 15_000) return response.status(429).json({ error: 'LOCATION_RATE_LIMITED' })
    try {
      const changed = await prisma.rider.updateMany({ where: { id: riderId, availability: 'ONLINE', status: 'APPROVED' }, data: { availabilityLatitude: result.data.latitude, availabilityLongitude: result.data.longitude, availabilityAccuracyM: Math.round(result.data.accuracy), availabilityLocatedAt: new Date(result.data.timestamp) } })
      if (changed.count !== 1) return response.status(409).json({ error: 'RIDER_NOT_ONLINE', message: 'Go online before sharing your availability location.' })
      availabilityLocationTimes.set(riderId, Date.now())
      return response.status(202).json({ accepted: true })
    } catch (error) { return fail(response, error, 'RIDER_AVAILABILITY_SERVICE_UNAVAILABLE') }
  })

  router.delete('/rider/availability-location', requireUser, requireRider, async (request, response) => {
    try {
      await prisma.rider.update({ where: { id: request.user.rider.id }, data: { availabilityLatitude: null, availabilityLongitude: null, availabilityAccuracyM: null, availabilityLocatedAt: null } })
      return response.status(204).end()
    } catch (error) { return fail(response, error, 'RIDER_AVAILABILITY_SERVICE_UNAVAILABLE') }
  })

  return router
}

/** Retire a reference Paystack can no longer use, keeping it on record so a late webhook can still be reconciled. */
export async function rotatePaymentReference(prisma, payment, providerStatus, prefix = 'DSPPKG') {
  const nextReference = `${prefix}-${randomUUID()}`
  return prisma.$transaction(async (transaction) => {
    await transaction.transaction.create({ data: { paymentId: payment.id, type: 'PAYMENT_REFERENCE_ROTATED', amountMinor: payment.amountMinor, providerReference: payment.reference, metadata: { providerStatus, replacedBy: nextReference } } })
    return transaction.payment.update({ where: { id: payment.id }, data: { reference: nextReference, status: 'PENDING', instructionsSnapshot: null } })
  })
}

/**
 * Applies a Paystack verify/webhook result to a payment (parcel or order handled by caller for orders).
 * Returns what happened so the caller can report it truthfully.
 */
export async function applyPaystackVerification(prisma, payment, verified, source, { expectedReference = payment.reference } = {}) {
  if (verified.status !== 'success') {
    if (verified.status === 'failed' && payment.status === 'PENDING') await prisma.payment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { status: 'FAILED' } })
    return { status: verified.status }
  }
  if (verified.reference !== expectedReference || verified.currency !== 'NGN' || verified.amount !== payment.amountMinor) {
    await prisma.$transaction(async (transaction) => {
      await transaction.payment.updateMany({ where: { id: payment.id, status: { not: 'SUCCESSFUL' } }, data: { status: 'AMOUNT_MISMATCH' } })
      await transaction.transaction.create({ data: { paymentId: payment.id, type: 'PAYMENT_RECONCILIATION_FAILED', amountMinor: Number.isSafeInteger(verified.amount) ? verified.amount : 0, providerReference: verified.reference || expectedReference, metadata: { source, currency: verified.currency } } })
    })
    return { status: 'mismatch' }
  }
  return prisma.$transaction((transaction) => confirmParcelPayment(transaction, payment, { providerReference: verified.reference, providerTransactionId: verified.id, source, metadata: { gatewayResponse: verified.gatewayResponse, paidAt: verified.paidAt } }))
}
