import { prisma } from './prisma.js'
import { parcelStatusByDeliveryStatus, RIDER_REQUEST_TTL_MS } from './parcelService.js'
import { notifyUsers, restaurantTeamIds } from './notify.js'
import { naira, recordDeliveryCompleted } from './financeLedger.js'
import { codeMatches, deliveryCodeFor, deliveryCodeSecret, MAX_CODE_ATTEMPTS } from './dispatch.js'

export const deliveryTransitions = {
  AVAILABLE: ['REQUESTED', 'CANCELLED'],
  REQUESTED: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['GOING_TO_RESTAURANT', 'CANCELLED'],
  GOING_TO_RESTAURANT: ['ARRIVED_AT_RESTAURANT'],
  ARRIVED_AT_RESTAURANT: ['PICKED_UP'],
  PICKED_UP: ['GOING_TO_CUSTOMER'],
  GOING_TO_CUSTOMER: ['DELIVERED'],
}

const orderStatusByDeliveryStatus = {
  ACCEPTED: 'RIDER_ASSIGNED',
  PICKED_UP: 'PICKED_UP',
  GOING_TO_CUSTOMER: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
}

export const activeLocationStatuses = new Set(['ACCEPTED', 'GOING_TO_RESTAURANT', 'ARRIVED_AT_RESTAURANT', 'PICKED_UP', 'GOING_TO_CUSTOMER'])
export const releasableStatuses = new Set(['ACCEPTED', 'GOING_TO_RESTAURANT', 'ARRIVED_AT_RESTAURANT'])
const locationUpdateTimes = new Map()
export const LOCATION_UPDATE_INTERVAL_MS = 2_000
const MAX_LOCATION_ACCURACY_METERS = 100
const MAX_LOCATION_AGE_MS = 5 * 60 * 1000
const MAX_LOCATION_FUTURE_MS = 30 * 1000

export function validateLocationUpdate(input, now = Date.now()) {
  if (!input || typeof input !== 'object') throw serviceError('INVALID_LOCATION', 'A valid location payload is required.', 400)
  const { latitude, longitude, accuracy, timestamp } = input
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw serviceError('INVALID_LOCATION', 'Coordinates are outside their permitted ranges.', 400)
  }
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > MAX_LOCATION_ACCURACY_METERS) {
    throw serviceError('INVALID_LOCATION_ACCURACY', 'Location accuracy is not acceptable.', 400)
  }
  const capturedAt = new Date(timestamp)
  if (Number.isNaN(capturedAt.getTime()) || capturedAt.getTime() > now + MAX_LOCATION_FUTURE_MS) {
    throw serviceError('INVALID_LOCATION_TIMESTAMP', 'Location timestamp is invalid.', 400)
  }
  if (capturedAt.getTime() < now - MAX_LOCATION_AGE_MS) {
    throw serviceError('STALE_LOCATION', 'Location timestamp is too old.', 400)
  }
  return { latitude, longitude, accuracy, capturedAt }
}

async function recordParcelEvent(transaction, bookingId, status, { actorId = null, actorRole = null, note = null } = {}) {
  await transaction.parcelEvent.create({ data: { bookingId, status, actorId, actorRole, note } })
}

async function notifyParcelCustomer(transaction, booking, title, body) {
  await transaction.notification.create({ data: { userId: booking.customerId, type: 'DELIVERY', title, body, link: `/parcels/${booking.id}` } })
}

const foodOrderMessages = {
  ACCEPTED: (order, riderName) => ({ customer: ['Rider assigned', `${riderName} is collecting your order ${order.orderNumber}.`], team: ['Rider on the way', `${riderName} accepted order ${order.orderNumber} and is heading to you.`] }),
  ARRIVED_AT_RESTAURANT: (order, riderName) => ({ team: ['Rider has arrived', `${riderName} is at your counter for order ${order.orderNumber}.`] }),
  PICKED_UP: (order) => ({ customer: ['Order picked up', `Your order ${order.orderNumber} has left the restaurant.`], team: ['Order collected', `Order ${order.orderNumber} was picked up.`] }),
  GOING_TO_CUSTOMER: (order) => ({ customer: ['Your rider is on the way', `Order ${order.orderNumber} is heading to you. Keep your phone close.`] }),
  DELIVERED: (order) => ({ customer: ['Delivered. Enjoy!', `Order ${order.orderNumber} was delivered. Tap to rate your order.`], team: ['Order delivered', `Order ${order.orderNumber} reached the customer.`] }),
}

async function notifyFoodOrder(transaction, orderId, deliveryStatus, riderName = 'Your rider') {
  const build = foodOrderMessages[deliveryStatus]
  if (!build) return
  const order = await transaction.order.findUnique({ where: { id: orderId }, select: { id: true, orderNumber: true, customerId: true, restaurantId: true } })
  if (!order) return
  const messages = build(order, riderName)
  if (messages.customer) await notifyUsers(transaction, [order.customerId], { type: 'DELIVERY', title: messages.customer[0], body: messages.customer[1], link: `/account/orders/${order.id}` })
  if (messages.team) await notifyUsers(transaction, await restaurantTeamIds(transaction, order.restaurantId), { type: 'DELIVERY', title: messages.team[0], body: messages.team[1], link: '/restaurant/orders' })
}

export async function claimDelivery(deliveryId, riderId, now = new Date()) {
  return prisma.$transaction(async (transaction) => {
    const rider = await transaction.rider.findUnique({ where: { id: riderId }, include: { user: { select: { id: true, firstName: true } } } })
    if (!rider || rider.status !== 'APPROVED' || rider.availability !== 'ONLINE') throw serviceError('RIDER_NOT_AVAILABLE', 'Rider must be approved and online.', 403)
    const deliveryBeforeClaim = await transaction.delivery.findUnique({ where: { id: deliveryId }, include: { order: { select: { restaurantId: true } }, parcelBooking: { select: { id: true, customerId: true, reference: true, status: true } } } })
    if (!deliveryBeforeClaim) throw serviceError('DELIVERY_NOT_FOUND', 'Delivery was not found.', 404)
    if (rider.network === 'BUSINESS_OWNED' && (!deliveryBeforeClaim.order || rider.restaurantId !== deliveryBeforeClaim.order.restaurantId)) {
      throw serviceError('BUSINESS_RIDER_DELIVERY_FORBIDDEN', 'Business riders can only claim deliveries for their own business.', 403)
    }
    const requestStillReserved = deliveryBeforeClaim.status === 'REQUESTED' && deliveryBeforeClaim.requestedRiderId && deliveryBeforeClaim.requestExpiresAt && deliveryBeforeClaim.requestExpiresAt > now
    if (requestStillReserved && deliveryBeforeClaim.requestedRiderId !== riderId) throw serviceError('DELIVERY_RESERVED_FOR_ANOTHER_RIDER', 'This delivery was requested from another rider.', 409)
    const conflicting = await transaction.delivery.count({ where: { riderId, status: { in: [...activeLocationStatuses] }, NOT: { id: deliveryId } } })
    if (conflicting > 0) throw serviceError('RIDER_HAS_ACTIVE_DELIVERY', 'Finish your current delivery before accepting another one.', 409)
    const claimed = await transaction.delivery.updateMany({ where: { id: deliveryId, status: { in: ['AVAILABLE', 'REQUESTED'] }, riderId: null }, data: { riderId, status: 'ACCEPTED', acceptedAt: now, requestedRiderId: null, requestExpiresAt: null } })
    if (claimed.count !== 1) throw serviceError('DELIVERY_ALREADY_CLAIMED', 'Another rider has already accepted this delivery.', 409)
    await transaction.dispatchOffer.updateMany({ where: { deliveryId, riderId, status: 'OFFERED' }, data: { status: 'ACCEPTED', respondedAt: now } })
    if (deliveryBeforeClaim.orderId) {
      await transaction.order.update({ where: { id: deliveryBeforeClaim.orderId }, data: { riderId, status: 'RIDER_ASSIGNED' } })
      await notifyFoodOrder(transaction, deliveryBeforeClaim.orderId, 'ACCEPTED', rider.user.firstName)
    } else if (deliveryBeforeClaim.parcelBooking) {
      const booking = deliveryBeforeClaim.parcelBooking
      const changed = await transaction.parcelBooking.updateMany({ where: { id: booking.id, status: 'SEARCHING_FOR_RIDER' }, data: { riderId, status: 'RIDER_ASSIGNED', assignedAt: now } })
      if (changed.count !== 1) throw serviceError('PARCEL_STATE_CHANGED', 'This booking is no longer waiting for a rider.', 409)
      await recordParcelEvent(transaction, booking.id, 'RIDER_ASSIGNED', { actorId: rider.user.id, actorRole: 'RIDER' })
      await notifyParcelCustomer(transaction, booking, 'Rider assigned', `${rider.user.firstName} accepted your delivery ${booking.reference}.`)
    }
    return transaction.delivery.findUnique({ where: { id: deliveryId } })
  })
}

export async function rejectDeliveryRequest(deliveryId, riderId) {
  return prisma.$transaction(async (transaction) => {
    const delivery = await transaction.delivery.findUnique({ where: { id: deliveryId }, include: { parcelBooking: { select: { id: true, customerId: true, reference: true } } } })
    if (!delivery) throw serviceError('DELIVERY_NOT_FOUND', 'Delivery was not found.', 404)
    if (delivery.status !== 'REQUESTED' || delivery.requestedRiderId !== riderId) throw serviceError('NO_PENDING_REQUEST', 'There is no pending request for you on this delivery.', 409)
    const changed = await transaction.delivery.updateMany({ where: { id: deliveryId, status: 'REQUESTED', requestedRiderId: riderId }, data: { status: 'AVAILABLE', requestedRiderId: null, requestExpiresAt: null } })
    if (changed.count !== 1) throw serviceError('DELIVERY_STATE_CHANGED', 'This delivery changed while you were responding.', 409)
    await transaction.dispatchOffer.updateMany({ where: { deliveryId, riderId, status: 'OFFERED' }, data: { status: 'DECLINED', respondedAt: new Date() } })
    if (delivery.parcelBooking) {
      await recordParcelEvent(transaction, delivery.parcelBooking.id, 'SEARCHING_FOR_RIDER', { actorRole: 'RIDER', note: 'Requested rider declined' })
      await notifyParcelCustomer(transaction, delivery.parcelBooking, 'Rider unavailable', `The rider you requested for ${delivery.parcelBooking.reference} declined. You can request another available rider.`)
    }
    return transaction.delivery.findUnique({ where: { id: deliveryId } })
  })
}

/** An assigned rider hands a delivery back before pickup; it returns to the open pool. */
export async function releaseDelivery(deliveryId, riderId, reason) {
  return prisma.$transaction(async (transaction) => {
    const delivery = await transaction.delivery.findUnique({ where: { id: deliveryId }, include: { parcelBooking: { select: { id: true, customerId: true, reference: true } } } })
    if (!delivery) throw serviceError('DELIVERY_NOT_FOUND', 'Delivery was not found.', 404)
    if (delivery.riderId !== riderId) throw serviceError('ASSIGNED_RIDER_REQUIRED', 'Only the assigned rider can release this delivery.', 403)
    if (delivery.orderId) throw serviceError('RELEASE_NOT_SUPPORTED', 'Contact DOORSTEP support to hand back a food order.', 409)
    if (!releasableStatuses.has(delivery.status)) throw serviceError('DELIVERY_NOT_RELEASABLE', 'A delivery can only be released before the package is picked up.', 409)
    const changed = await transaction.delivery.updateMany({ where: { id: deliveryId, riderId, status: delivery.status }, data: { riderId: null, status: 'AVAILABLE', acceptedAt: null } })
    if (changed.count !== 1) throw serviceError('DELIVERY_STATE_CHANGED', 'This delivery changed while you were responding.', 409)
    if (delivery.parcelBooking) {
      await transaction.parcelBooking.update({ where: { id: delivery.parcelBooking.id }, data: { riderId: null, status: 'SEARCHING_FOR_RIDER', assignedAt: null } })
      await recordParcelEvent(transaction, delivery.parcelBooking.id, 'SEARCHING_FOR_RIDER', { actorRole: 'RIDER', note: reason ? `Rider released the delivery: ${reason}` : 'Rider released the delivery' })
      await notifyParcelCustomer(transaction, delivery.parcelBooking, 'Finding another rider', `Your rider could not continue with ${delivery.parcelBooking.reference}. We are looking for another rider.`)
    }
    return transaction.delivery.findUnique({ where: { id: deliveryId } })
  })
}

/**
 * Proof of delivery for food orders: the rider enters the customer's 4-digit code. Wrong codes are counted and
 * the delivery locks after MAX_CODE_ATTEMPTS, so a code can't be guessed; DOORSTEP support can then confirm it.
 */
export async function checkDeliveryCode(deliveryId, riderId, code) {
  const delivery = await prisma.delivery.findUnique({ where: { id: deliveryId }, select: { id: true, riderId: true, orderId: true, codeAttempts: true } })
  if (!delivery) throw serviceError('DELIVERY_NOT_FOUND', 'Delivery was not found.', 404)
  if (delivery.riderId !== riderId) throw serviceError('ASSIGNED_RIDER_REQUIRED', 'Only the assigned rider can complete this delivery.', 403)
  if (!delivery.orderId) return true
  if (delivery.codeAttempts >= MAX_CODE_ATTEMPTS) throw serviceError('DELIVERY_CODE_LOCKED', 'Too many wrong codes. Call DOORSTEP support to confirm this delivery.', 423)
  if (!code) throw serviceError('DELIVERY_CODE_REQUIRED', 'Ask the customer for their 4-digit delivery code.', 400)
  const expected = deliveryCodeFor(delivery.id, await deliveryCodeSecret(prisma))
  if (codeMatches(code, expected)) return true
  const updated = await prisma.delivery.update({ where: { id: deliveryId }, data: { codeAttempts: { increment: 1 } }, select: { codeAttempts: true } })
  const left = MAX_CODE_ATTEMPTS - updated.codeAttempts
  throw serviceError('DELIVERY_CODE_WRONG', left > 0 ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left — check it with the customer.` : 'Too many wrong codes. Call DOORSTEP support to confirm this delivery.', left > 0 ? 422 : 423)
}

export async function advanceDelivery(deliveryId, riderId, nextStatus, { code, adminConfirmedBy = null } = {}) {
  if (nextStatus === 'DELIVERED' && !adminConfirmedBy) await checkDeliveryCode(deliveryId, riderId, code)
  return prisma.$transaction(async (transaction) => {
    const delivery = await transaction.delivery.findUnique({ where: { id: deliveryId }, include: { parcelBooking: { select: { id: true, customerId: true, reference: true, status: true } } } })
    if (!delivery) throw serviceError('DELIVERY_NOT_FOUND', 'Delivery was not found.', 404)
    if (delivery.riderId !== riderId) throw serviceError('ASSIGNED_RIDER_REQUIRED', 'Only the assigned rider can advance this delivery.', 403)
    if (!deliveryTransitions[delivery.status]?.includes(nextStatus)) throw serviceError('INVALID_DELIVERY_TRANSITION', 'Delivery stages must be completed in order.', 409)
    const now = new Date()
    const timestamps = { ACCEPTED: { acceptedAt: now }, PICKED_UP: { pickedUpAt: now }, DELIVERED: { deliveredAt: now, proofMethod: delivery.orderId ? (adminConfirmedBy ? 'ADMIN_CONFIRMED' : 'CUSTOMER_CODE') : null } }
    const updatedCount = await transaction.delivery.updateMany({ where: { id: deliveryId, riderId, status: delivery.status }, data: { status: nextStatus, ...(timestamps[nextStatus] || {}) } })
    if (updatedCount.count !== 1) throw serviceError('DELIVERY_STATE_CHANGED', 'This delivery was updated by another request. Refresh and try again.', 409)
    const updated = await transaction.delivery.findUnique({ where: { id: deliveryId } })
    if (delivery.orderId) {
      const orderStatus = orderStatusByDeliveryStatus[nextStatus]
      if (orderStatus) await transaction.order.update({ where: { id: delivery.orderId }, data: { status: orderStatus, ...(nextStatus === 'PICKED_UP' ? { pickedUpAt: now } : {}), ...(nextStatus === 'DELIVERED' ? { deliveredAt: now } : {}) } })
      await notifyFoodOrder(transaction, delivery.orderId, nextStatus)
    } else if (delivery.parcelBooking) {
      const booking = delivery.parcelBooking
      const parcelStatus = parcelStatusByDeliveryStatus[nextStatus]
      if (parcelStatus && parcelStatus !== booking.status) {
        const changed = await transaction.parcelBooking.updateMany({ where: { id: booking.id, status: booking.status }, data: { status: parcelStatus, ...(parcelStatus === 'PICKED_UP' ? { pickedUpAt: now } : {}), ...(parcelStatus === 'DELIVERED' ? { deliveredAt: now } : {}) } })
        if (changed.count !== 1) throw serviceError('PARCEL_STATE_CHANGED', 'This booking changed while you were updating it.', 409)
        await recordParcelEvent(transaction, booking.id, parcelStatus, { actorRole: 'RIDER' })
        const messages = {
          RIDER_EN_ROUTE_TO_PICKUP: ['Rider on the way to pickup', `Your rider is heading to the pickup point for ${booking.reference}.`],
          PICKED_UP: ['Package picked up', `Your package ${booking.reference} has been collected.`],
          IN_TRANSIT: ['Package in transit', `Your package ${booking.reference} is on its way to the recipient.`],
          DELIVERED: ['Package delivered', `Your package ${booking.reference} was delivered.`],
        }
        if (messages[parcelStatus]) await notifyParcelCustomer(transaction, booking, ...messages[parcelStatus])
      } else if (nextStatus === 'ARRIVED_AT_RESTAURANT') {
        await recordParcelEvent(transaction, booking.id, booking.status, { actorRole: 'RIDER', note: 'Rider arrived at pickup' })
      }
    }
    if (nextStatus === 'DELIVERED') {
      // Rider earning from the Sapele distance rates, and any business-share correction.
      const earning = await recordDeliveryCompleted(transaction, deliveryId)
      if (earning) {
        const rider = await transaction.rider.findUnique({ where: { id: riderId }, select: { userId: true } })
        if (rider) await notifyUsers(transaction, [rider.userId], earning.status === 'DUE'
          ? { type: 'PAYMENT', title: `You earned ${naira(earning.amountMinor)}`, body: `${earning.description}. It is added to your next payout.`, link: '/rider/earnings' }
          : { type: 'PAYMENT', title: 'Delivery completed', body: 'DOORSTEP will confirm the earning for this delivery shortly.', link: '/rider/earnings' })
      }
    }
    return updated
  })
}

export async function recordLocation(deliveryId, riderId, location) {
  const delivery = await prisma.delivery.findUnique({ where: { id: deliveryId } })
  if (!delivery || delivery.riderId !== riderId) throw serviceError('ASSIGNED_RIDER_REQUIRED', 'Only the assigned rider can share this location.', 403)
  if (!activeLocationStatuses.has(delivery.status)) throw serviceError('LOCATION_NOT_ACTIVE', 'Location sharing is only available during an active delivery.', 409)
  const lastUpdate = locationUpdateTimes.get(`${deliveryId}:${riderId}`)
  if (lastUpdate && Date.now() - lastUpdate < LOCATION_UPDATE_INTERVAL_MS) throw serviceError('LOCATION_RATE_LIMITED', 'Location updates are arriving too quickly.', 429)
  const saved = await prisma.riderLocation.create({ data: { riderId, deliveryId, latitude: location.latitude, longitude: location.longitude, recordedAt: location.capturedAt instanceof Date ? location.capturedAt : new Date() } })
  locationUpdateTimes.set(`${deliveryId}:${riderId}`, Date.now())
  return saved
}

function riderPublicProfile(rider) {
  if (!rider) return null
  return {
    firstName: rider.user?.firstName || 'Rider',
    vehicleType: rider.vehicleType || null,
    rating: rider.ratingCount > 0 ? { average: Number(rider.ratingAverage), count: rider.ratingCount } : null,
  }
}

export async function getDeliveryTrackingSnapshot(deliveryId, user, { activeOnly = false } = {}) {
  const delivery = await prisma.delivery.findUnique({
    where: { id: deliveryId },
    include: {
      rider: { select: { vehicleType: true, ratingAverage: true, ratingCount: true, user: { select: { firstName: true, phone: true } } } },
      order: {
        select: {
          id: true,
          orderNumber: true,
          customerId: true,
          status: true,
          addressSnapshot: true,
          latitude: true,
          longitude: true,
          restaurant: { select: { name: true, address: true } },
        },
      },
      parcelBooking: {
        select: {
          id: true, reference: true, customerId: true, status: true,
          pickupAddress: true, pickupLatitude: true, pickupLongitude: true,
          dropoffAddress: true, dropoffLatitude: true, dropoffLongitude: true,
          routeGeometry: true, distanceMeters: true, durationSeconds: true,
        },
      },
    },
  })
  if (!delivery) throw serviceError('DELIVERY_NOT_FOUND', 'Delivery was not found.', 404)
  const active = activeLocationStatuses.has(delivery.status)
  const ownerId = delivery.order?.customerId || delivery.parcelBooking?.customerId
  const assignedRider = user.role === 'RIDER' && user.rider?.id === delivery.riderId
  const customer = user.role === 'CUSTOMER' && user.id === ownerId
  const administrator = user.role === 'ADMIN' && active
  if (!customer && !assignedRider && !administrator) throw serviceError('DELIVERY_ACCESS_FORBIDDEN', 'You cannot track this delivery.', 403)
  if (activeOnly && !active) throw serviceError('LOCATION_NOT_ACTIVE', 'Live tracking is only available for active deliveries.', 409)
  // Precise rider position is only disclosed while the delivery is active.
  const location = delivery.riderId && active
    ? await prisma.riderLocation.findFirst({ where: { riderId: delivery.riderId, deliveryId }, orderBy: { recordedAt: 'desc' } })
    : null
  const base = {
    delivery: {
      id: delivery.id,
      status: delivery.status,
      active,
      location: location ? { latitude: location.latitude, longitude: location.longitude, recordedAt: location.recordedAt } : null,
      rider: active ? riderPublicProfile(delivery.rider) : null,
    },
  }
  if (delivery.parcelBooking) {
    const booking = delivery.parcelBooking
    return {
      ...base,
      kind: 'parcel',
      parcel: {
        id: booking.id,
        reference: booking.reference,
        status: booking.status,
        pickup: { address: booking.pickupAddress, latitude: booking.pickupLatitude, longitude: booking.pickupLongitude },
        destination: { address: booking.dropoffAddress, latitude: booking.dropoffLatitude, longitude: booking.dropoffLongitude },
        route: { geometry: booking.routeGeometry, distanceMeters: booking.distanceMeters, durationSeconds: booking.durationSeconds },
      },
    }
  }
  return {
    ...base,
    kind: 'order',
    order: {
      id: delivery.order.id,
      orderNumber: delivery.order.orderNumber,
      status: delivery.order.status,
      restaurant: {
        name: delivery.order.restaurant.name,
        address: delivery.order.restaurant.address,
      },
      destination: {
        latitude: delivery.order.latitude,
        longitude: delivery.order.longitude,
        address: delivery.order.addressSnapshot,
      },
    },
  }
}

export function serviceError(code, message, status) { return Object.assign(new Error(message), { code, status }) }

export { RIDER_REQUEST_TTL_MS }
