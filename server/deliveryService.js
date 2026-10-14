import { prisma } from './prisma.js'

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

const activeLocationStatuses = new Set(['ACCEPTED', 'GOING_TO_RESTAURANT', 'ARRIVED_AT_RESTAURANT', 'PICKED_UP', 'GOING_TO_CUSTOMER'])
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

export async function claimDelivery(deliveryId, riderId) {
  return prisma.$transaction(async (transaction) => {
    const rider = await transaction.rider.findUnique({ where: { id: riderId } })
    if (!rider || rider.status !== 'APPROVED' || rider.availability !== 'ONLINE') throw serviceError('RIDER_NOT_AVAILABLE', 'Rider must be approved and online.', 403)
    const claimed = await transaction.delivery.updateMany({ where: { id: deliveryId, status: { in: ['AVAILABLE', 'REQUESTED'] }, riderId: null }, data: { riderId, status: 'ACCEPTED', acceptedAt: new Date() } })
    if (claimed.count !== 1) throw serviceError('DELIVERY_ALREADY_CLAIMED', 'Another rider has already accepted this delivery.', 409)
    const delivery = await transaction.delivery.findUnique({ where: { id: deliveryId } })
    await transaction.order.update({ where: { id: delivery.orderId }, data: { riderId, status: 'RIDER_ASSIGNED' } })
    return delivery
  })
}

export async function advanceDelivery(deliveryId, riderId, nextStatus) {
  return prisma.$transaction(async (transaction) => {
    const delivery = await transaction.delivery.findUnique({ where: { id: deliveryId } })
    if (!delivery) throw serviceError('DELIVERY_NOT_FOUND', 'Delivery was not found.', 404)
    if (delivery.riderId !== riderId) throw serviceError('ASSIGNED_RIDER_REQUIRED', 'Only the assigned rider can advance this delivery.', 403)
    if (!deliveryTransitions[delivery.status]?.includes(nextStatus)) throw serviceError('INVALID_DELIVERY_TRANSITION', 'Delivery stages must be completed in order.', 409)
    const timestamps = { ACCEPTED: { acceptedAt: new Date() }, PICKED_UP: { pickedUpAt: new Date() }, DELIVERED: { deliveredAt: new Date() } }
    const updatedCount = await transaction.delivery.updateMany({ where: { id: deliveryId, riderId, status: delivery.status }, data: { status: nextStatus, ...(timestamps[nextStatus] || {}) } })
    if (updatedCount.count !== 1) throw serviceError('DELIVERY_STATE_CHANGED', 'This delivery was updated by another request. Refresh and try again.', 409)
    const updated = await transaction.delivery.findUnique({ where: { id: deliveryId } })
    const orderStatus = orderStatusByDeliveryStatus[nextStatus]
    if (orderStatus) await transaction.order.update({ where: { id: delivery.orderId }, data: { status: orderStatus, ...(nextStatus === 'PICKED_UP' ? { pickedUpAt: new Date() } : {}), ...(nextStatus === 'DELIVERED' ? { deliveredAt: new Date() } : {}) } })
    return updated
  })
}

export async function recordLocation(deliveryId, riderId, location) {
  const delivery = await prisma.delivery.findUnique({ where: { id: deliveryId } })
  if (!delivery || delivery.riderId !== riderId) throw serviceError('ASSIGNED_RIDER_REQUIRED', 'Only the assigned rider can share this location.', 403)
  if (!activeLocationStatuses.has(delivery.status)) throw serviceError('LOCATION_NOT_ACTIVE', 'Location sharing is only available during an active delivery.', 409)
  const lastUpdate = locationUpdateTimes.get(`${deliveryId}:${riderId}`)
  if (lastUpdate && Date.now() - lastUpdate < LOCATION_UPDATE_INTERVAL_MS) throw serviceError('LOCATION_RATE_LIMITED', 'Location updates are arriving too quickly.', 429)
  const saved = await prisma.riderLocation.create({ data: { riderId, deliveryId, latitude: location.latitude, longitude: location.longitude } })
  locationUpdateTimes.set(`${deliveryId}:${riderId}`, Date.now())
  return saved
}

export async function getDeliveryTrackingSnapshot(deliveryId, user, { activeOnly = false } = {}) {
  const delivery = await prisma.delivery.findUnique({
    where: { id: deliveryId },
    include: {
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
    },
  })
  if (!delivery) throw serviceError('DELIVERY_NOT_FOUND', 'Delivery was not found.', 404)
  const active = activeLocationStatuses.has(delivery.status)
  const assignedRider = user.role === 'RIDER' && user.rider?.id === delivery.riderId
  const customer = user.role === 'CUSTOMER' && user.id === delivery.order.customerId
  const administrator = user.role === 'ADMIN' && active
  if (!customer && !assignedRider && !administrator) throw serviceError('DELIVERY_ACCESS_FORBIDDEN', 'You cannot track this delivery.', 403)
  if (activeOnly && !active) throw serviceError('LOCATION_NOT_ACTIVE', 'Live tracking is only available for active deliveries.', 409)
  const location = delivery.riderId
    ? await prisma.riderLocation.findFirst({ where: { riderId: delivery.riderId, deliveryId }, orderBy: { recordedAt: 'desc' } })
    : null
  return {
    delivery: {
      id: delivery.id,
      status: delivery.status,
      active,
      location: location ? { latitude: location.latitude, longitude: location.longitude, recordedAt: location.recordedAt } : null,
    },
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
