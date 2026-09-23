import { prisma } from './prisma.js'

export function requireAdmin(request, response, next) {
  if (request.user?.role !== 'ADMIN') return response.status(403).json({ error: 'ADMIN_ROLE_REQUIRED' })
  return next()
}

export async function reviewApplication({ type, id, status, note, actorId }) {
  return prisma.$transaction(async (transaction) => {
    if (type === 'restaurant') {
      const application = await transaction.restaurantApplication.findUnique({ where: { id }, include: { restaurant: true, documents: true } })
      if (!application) throw serviceError('APPLICATION_NOT_FOUND', 'Restaurant application was not found.', 404)
      const updated = await transaction.restaurantApplication.update({ where: { id }, data: { status, reviewNote: note, reviewedAt: new Date(), reviewedById: actorId } })
      await transaction.restaurant.update({ where: { id: application.restaurantId }, data: { status } })
      await transaction.auditLog.create({ data: { actorId, action: `REVIEW_${status}`, entityType: 'RestaurantApplication', entityId: id, metadata: { restaurantId: application.restaurantId, documentCount: application.documents.length } } })
      return updated
    }

    const application = await transaction.riderApplication.findUnique({ where: { id }, include: { rider: true, identityDocuments: true } })
    if (!application) throw serviceError('APPLICATION_NOT_FOUND', 'Rider application was not found.', 404)
    const updated = await transaction.riderApplication.update({ where: { id }, data: { status, reviewNote: note, reviewedAt: new Date(), reviewedById: actorId } })
    await transaction.rider.update({ where: { id: application.riderId }, data: { status } })
    await transaction.auditLog.create({ data: { actorId, action: `REVIEW_${status}`, entityType: 'RiderApplication', entityId: id, metadata: { riderId: application.riderId, documentCount: application.identityDocuments.length } } })
    return updated
  })
}

function serviceError(code, message, status) { return Object.assign(new Error(message), { code, status }) }
