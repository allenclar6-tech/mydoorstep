import { prisma } from './prisma.js'
import { notifyUsers, restaurantTeamIds } from './notify.js'

export function requireAdmin(request, response, next) {
  if (request.user?.role !== 'ADMIN') return response.status(403).json({ error: 'ADMIN_ROLE_REQUIRED' })
  return next()
}

export async function reviewApplication({ type, id, status, note, actorId }) {
  return prisma.$transaction(async (transaction) => {
    if (type === 'restaurant' || type === 'grocery') {
      const application = await transaction.restaurantApplication.findUnique({ where: { id }, include: { restaurant: true, documents: true } })
      if (!application || application.restaurant.storeType !== (type === 'grocery' ? 'GROCERY' : 'RESTAURANT')) throw serviceError('APPLICATION_NOT_FOUND', 'Business application was not found.', 404)
      const updated = await transaction.restaurantApplication.update({ where: { id }, data: { status, reviewNote: note, reviewedAt: new Date(), reviewedById: actorId } })
      await transaction.applicationReview.create({ data: { applicationType: 'RESTAURANT', applicationId: id, previousStatus: application.status, status, note, actorId } })
      await transaction.restaurant.update({ where: { id: application.restaurantId }, data: { status } })
      await transaction.auditLog.create({ data: { actorId, action: `REVIEW_${status}`, entityType: 'RestaurantApplication', entityId: id, metadata: { restaurantId: application.restaurantId, documentCount: application.documents.length } } })
      const message = decisionMessage(status, application.restaurant.name, note, type === 'grocery' ? 'store' : 'restaurant')
      if (message) await notifyUsers(transaction, await restaurantTeamIds(transaction, application.restaurantId), { type: 'ACCOUNT', ...message, link: status === 'APPROVED' ? '/restaurant/dashboard' : '/partner/application-status' })
      return updated
    }

    const application = await transaction.riderApplication.findUnique({ where: { id }, include: { rider: true, identityDocuments: true } })
    if (!application) throw serviceError('APPLICATION_NOT_FOUND', 'Rider application was not found.', 404)
    const updated = await transaction.riderApplication.update({ where: { id }, data: { status, reviewNote: note, reviewedAt: new Date(), reviewedById: actorId } })
    await transaction.applicationReview.create({ data: { applicationType: 'RIDER', applicationId: id, previousStatus: application.status, status, note, actorId } })
    await transaction.rider.update({ where: { id: application.riderId }, data: { status } })
    await transaction.auditLog.create({ data: { actorId, action: `REVIEW_${status}`, entityType: 'RiderApplication', entityId: id, metadata: { riderId: application.riderId, documentCount: application.identityDocuments.length } } })
    const message = decisionMessage(status, 'Your rider account', note, 'rider')
    if (message) await notifyUsers(transaction, [application.rider.userId], { type: 'ACCOUNT', ...message, link: status === 'APPROVED' ? '/rider/dashboard' : '/rider/application-status' })
    return updated
  })
}

function decisionMessage(status, name, note, kind) {
  const extra = note ? ` Note from DOORSTEP: ${note}` : ''
  if (status === 'APPROVED') return { title: kind === 'rider' ? 'You are approved to ride' : 'You are live on DOORSTEP', body: kind === 'rider' ? `${name} is approved. Go online whenever you are ready to take deliveries.${extra}` : `${name} is approved. Customers can now find you and place orders.${extra}` }
  if (status === 'NEEDS_INFORMATION') return { title: 'We need a little more information', body: `${name}: please update your application so we can finish the review.${extra}` }
  if (status === 'REJECTED') return { title: 'Application not approved', body: `${name} was not approved this time.${extra}` }
  if (status === 'SUSPENDED') return { title: 'Account suspended', body: `${name} has been suspended. Contact DOORSTEP support for details.${extra}` }
  return null
}

function serviceError(code, message, status) { return Object.assign(new Error(message), { code, status }) }
