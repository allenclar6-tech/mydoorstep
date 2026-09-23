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

export async function recordLocation(deliveryId, riderId, latitude, longitude) {
  const delivery = await prisma.delivery.findUnique({ where: { id: deliveryId } })
  if (!delivery || delivery.riderId !== riderId) throw serviceError('ASSIGNED_RIDER_REQUIRED', 'Only the assigned rider can share this location.', 403)
  if (!['ACCEPTED', 'GOING_TO_RESTAURANT', 'ARRIVED_AT_RESTAURANT', 'PICKED_UP', 'GOING_TO_CUSTOMER'].includes(delivery.status)) throw serviceError('LOCATION_NOT_ACTIVE', 'Location sharing is only available during an active delivery.', 409)
  return prisma.riderLocation.create({ data: { riderId, deliveryId, latitude, longitude } })
}

export function serviceError(code, message, status) { return Object.assign(new Error(message), { code, status }) }
