import { Router } from 'express'
import { z } from 'zod'
import { parsePeriod } from './bookkeeping.js'
import { deliveryOverview, riderPerformance } from './deliveryOverview.js'
import { DispatchError, failDelivery, FAILURE_REASONS, markArrived, unassignRider } from './dispatchControl.js'
import { offerToRider } from './dispatch.js'

// Dispatch control, Delivery overview and rider performance. Admin paths are protected by the staff guard
// (dispatch / overview areas); the rider "arrived" path checks the rider is on the job.

export function createDispatchRouter({ prisma, requireUser, notifyUsers, broadcastStatus = () => {} }) {
  const router = Router()
  const fail = (response, error) => {
    if (error instanceof DispatchError) return response.status(error.status).json({ error: error.code, message: error.message })
    console.error('[dispatch]', error?.message)
    return response.status(503).json({ error: 'DISPATCH_UNAVAILABLE', message: 'That didn’t work. Try again.' })
  }

  // Take the rider off a job before pickup; optionally offer it straight to another rider.
  router.post('/admin/deliveries/:deliveryId/unassign', requireUser, async (request, response) => {
    const parsed = z.object({ reason: z.string().trim().min(3).max(300), riderId: z.string().min(1).max(60).optional() }).strict().safeParse(request.body || {})
    if (!parsed.success) return response.status(400).json({ error: 'REASON_REQUIRED', message: 'Say briefly why the rider is being taken off this job.' })
    try {
      const removed = await unassignRider(prisma, request.params.deliveryId, request.user, { reason: parsed.data.reason }, { notifyUsers })
      broadcastStatus(request.params.deliveryId, 'AVAILABLE')
      if (!parsed.data.riderId) return response.json({ ...removed, offered: false })
      const offered = await offerToRider(prisma, request.params.deliveryId, parsed.data.riderId, { notifyUsers })
      if (offered.offered) await prisma.auditLog.create({ data: { actorId: request.user.id, action: 'DELIVERY_OFFERED_BY_ADMIN', entityType: 'Delivery', entityId: request.params.deliveryId, metadata: { riderId: parsed.data.riderId, reassigned: true } } })
      return response.json({ ...removed, offered: offered.offered, message: offered.offered ? null : `The rider was taken off, but the new rider couldn’t be offered the job: ${offered.message}` })
    } catch (error) { return fail(response, error) }
  })

  router.get('/admin/delivery-failure-reasons', requireUser, (_request, response) => response.json({ reasons: Object.entries(FAILURE_REASONS).map(([code, text]) => ({ code, text })) }))
  router.post('/admin/deliveries/:deliveryId/fail', requireUser, async (request, response) => {
    const parsed = z.object({ reason: z.enum(Object.keys(FAILURE_REASONS)), note: z.string().trim().min(5).max(500), refundMinor: z.number().int().min(0).optional(), riderPayMinor: z.number().int().min(0).nullable().optional() }).strict().safeParse(request.body || {})
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_FAILURE', message: 'Choose a reason and write what happened (at least a few words).' })
    try {
      const result = await failDelivery(prisma, request.params.deliveryId, request.user, { ...parsed.data, refundMinor: parsed.data.refundMinor ?? 0 }, { notifyUsers })
      broadcastStatus(request.params.deliveryId, 'CANCELLED')
      return response.json(result)
    } catch (error) { return fail(response, error) }
  })

  router.post('/deliveries/:deliveryId/arrived', requireUser, async (request, response) => {
    if (request.user.role !== 'RIDER' || !request.user.rider) return response.status(403).json({ error: 'RIDER_ROLE_REQUIRED' })
    try { return response.json(await markArrived(prisma, request.params.deliveryId, request.user.rider, { notifyUsers })) } catch (error) { return fail(response, error) }
  })

  router.get('/admin/delivery-overview', requireUser, async (request, response) => {
    try {
      const period = parsePeriod(request.query)
      const [overview, riders] = await Promise.all([deliveryOverview(prisma, period), riderPerformance(prisma, period)])
      return response.json({ period: { from: period.fromDay, to: period.toDay }, ...overview, riders })
    } catch (error) {
      if (error?.code === 'INVALID_PERIOD') return response.status(400).json({ error: error.code, message: error.message })
      return fail(response, error)
    }
  })

  return router
}
