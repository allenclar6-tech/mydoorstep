import { Router } from 'express'
import { z } from 'zod'
import { notifyAdmins, notifyUsers } from './notify.js'

// Rider road reports. Riders (approved DOORSTEP riders) report; Delivery managers / Super admins review (the
// /api/admin staff guard maps road-reports to the 'routes' area). Approved reports are shown as suggestions when
// pricing hard-to-map places — with their age and how many riders agree — and go stale after STALE_DAYS.

export const KINDS = { ROAD_CONDITION: 'Road condition', CLOSURE: 'Road closed', ACCESS: 'Access problem (gate, bridge, river)', DISTANCE: 'Real distance', LANDMARK: 'Landmark / directions', EXTRA_CHARGE: 'Extra charge needed' }
export const STALE_DAYS = 90
const areaKey = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Confidence from how many different riders' approved, fresh reports agree on an area and kind. */
export function confidenceFor(reports, now = new Date()) {
  const fresh = reports.filter((report) => report.status === 'APPROVED' && now - new Date(report.reviewedAt || report.createdAt) < STALE_DAYS * 86_400_000)
  const riders = new Set(fresh.map((report) => report.riderId)).size
  return { riders, level: riders >= 3 ? 'HIGH' : riders === 2 ? 'MEDIUM' : riders === 1 ? 'LOW' : 'NONE' }
}

/** Groups approved reports by area for the "what riders say" suggestions (newest first, stale ones flagged). */
export function suggestionsFor(reports, area, now = new Date()) {
  const key = areaKey(area)
  const matching = reports.filter((report) => report.status === 'APPROVED' && key && (areaKey(report.area).includes(key) || key.includes(areaKey(report.area))))
  const distances = matching.filter((report) => report.distanceKm != null && now - new Date(report.reviewedAt || report.createdAt) < STALE_DAYS * 86_400_000).map((report) => Number(report.distanceKm))
  return {
    confidence: confidenceFor(matching, now),
    suggestedKm: distances.length ? Math.round(distances.sort((a, b) => a - b)[Math.floor(distances.length / 2)] * 10) / 10 : null,
    reports: matching.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 10).map((report) => ({ id: report.id, kind: report.kind, kindText: KINDS[report.kind], area: report.area, note: report.note, distanceKm: report.distanceKm != null ? Number(report.distanceKm) : null, extraChargeMinor: report.extraChargeMinor, at: report.createdAt, stale: now - new Date(report.reviewedAt || report.createdAt) >= STALE_DAYS * 86_400_000 })),
  }
}

const reportSchema = z.object({
  kind: z.enum(Object.keys(KINDS)),
  area: z.string().trim().min(2).max(120),
  note: z.string().trim().min(5).max(500),
  orderNumber: z.string().trim().max(40).optional(),
  location: z.object({ latitude: z.number().min(4).max(14), longitude: z.number().min(2.5).max(15) }).optional(),
  distanceKm: z.number().positive().max(200).optional(),
  extraChargeMinor: z.number().int().min(0).max(5_000_000).optional(),
}).strict()

export function createRoadReportRouter({ prisma, requireUser }) {
  const router = Router()
  const riderOnly = (request, response) => {
    const rider = request.user.rider
    if (request.user.role !== 'RIDER' || !rider || rider.status !== 'APPROVED') { response.status(403).json({ error: 'APPROVED_RIDER_REQUIRED', message: 'Only approved DOORSTEP riders can report roads.' }); return null }
    return rider
  }

  router.post('/rider/road-reports', requireUser, async (request, response) => {
    const rider = riderOnly(request, response); if (!rider) return
    const parsed = reportSchema.safeParse(request.body || {})
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_REPORT', message: 'Choose what you’re reporting, name the area and describe it in a few words.' })
    try {
      const recent = await prisma.roadReport.count({ where: { riderId: rider.id, createdAt: { gte: new Date(Date.now() - 3_600_000) } } })
      if (recent >= 10) return response.status(429).json({ error: 'TOO_MANY_REPORTS', message: 'That’s a lot of reports this hour. Try again later.' })
      const order = parsed.data.orderNumber ? await prisma.order.findFirst({ where: { orderNumber: parsed.data.orderNumber, delivery: { riderId: rider.id } }, select: { id: true } }) : null
      const report = await prisma.roadReport.create({ data: { riderId: rider.id, orderId: order?.id || null, kind: parsed.data.kind, area: parsed.data.area, note: parsed.data.note, latitude: parsed.data.location?.latitude ?? null, longitude: parsed.data.location?.longitude ?? null, distanceKm: parsed.data.distanceKm ?? null, extraChargeMinor: parsed.data.extraChargeMinor ?? null } })
      await notifyAdmins(prisma, { type: 'DELIVERY', title: 'Road report to review', body: `${KINDS[report.kind]} · ${report.area}: ${report.note}`.slice(0, 200), link: '/admin/road-reports' })
      return response.status(201).json({ report: { id: report.id, status: report.status } })
    } catch { return response.status(503).json({ error: 'REPORTS_UNAVAILABLE', message: 'Your report wasn’t sent. Try again.' }) }
  })

  router.get('/rider/road-reports', requireUser, async (request, response) => {
    const rider = riderOnly(request, response); if (!rider) return
    try {
      const rows = await prisma.roadReport.findMany({ where: { riderId: rider.id }, orderBy: { createdAt: 'desc' }, take: 30 })
      return response.json({ kinds: KINDS, reports: rows.map((row) => ({ id: row.id, kind: row.kind, kindText: KINDS[row.kind], area: row.area, note: row.note, status: row.status, reviewNote: row.reviewNote, at: row.createdAt })) })
    } catch { return response.status(503).json({ error: 'REPORTS_UNAVAILABLE' }) }
  })

  /* ------------------------------ admin ------------------------------ */
  router.get('/admin/road-reports', requireUser, async (request, response) => {
    const status = ['PENDING', 'APPROVED', 'REJECTED'].includes(request.query.status) ? request.query.status : 'PENDING'
    try {
      const rows = await prisma.roadReport.findMany({ where: { status }, orderBy: { createdAt: status === 'PENDING' ? 'asc' : 'desc' }, take: 100 })
      const riders = rows.length ? await prisma.rider.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.riderId))] } }, select: { id: true, ratingAverage: true, ratingCount: true, user: { select: { firstName: true, lastName: true, phone: true } } } }) : []
      const who = new Map(riders.map((rider) => [rider.id, rider]))
      const approved = await prisma.roadReport.findMany({ where: { status: 'APPROVED' }, select: { area: true, kind: true, riderId: true, status: true, reviewedAt: true, createdAt: true } })
      const now = new Date()
      return response.json({ kinds: KINDS, reports: rows.map((row) => {
        const rider = who.get(row.riderId)
        const same = approved.filter((other) => other.kind === row.kind && areaKey(other.area) === areaKey(row.area))
        return { id: row.id, kind: row.kind, kindText: KINDS[row.kind], area: row.area, note: row.note, location: row.latitude != null ? { latitude: Number(row.latitude), longitude: Number(row.longitude) } : null, distanceKm: row.distanceKm != null ? Number(row.distanceKm) : null, extraChargeMinor: row.extraChargeMinor, status: row.status, reviewNote: row.reviewNote, at: row.createdAt, reviewedAt: row.reviewedAt, stale: row.status === 'APPROVED' && now - new Date(row.reviewedAt || row.createdAt) >= STALE_DAYS * 86_400_000, rider: rider ? { name: `${rider.user.firstName || ''} ${rider.user.lastName || ''}`.trim(), phone: rider.user.phone, rating: rider.ratingCount ? Number(rider.ratingAverage) : null } : null, agreement: confidenceFor(same, now) }
      }) })
    } catch { return response.status(503).json({ error: 'REPORTS_UNAVAILABLE' }) }
  })

  router.post('/admin/road-reports/:id/review', requireUser, async (request, response) => {
    const parsed = z.object({ decision: z.enum(['APPROVED', 'REJECTED']), note: z.string().trim().max(300).optional() }).strict().safeParse(request.body || {})
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_REVIEW' })
    try {
      const changed = await prisma.roadReport.updateMany({ where: { id: request.params.id, status: 'PENDING' }, data: { status: parsed.data.decision, reviewNote: parsed.data.note || null, reviewedById: request.user.id, reviewedAt: new Date() } })
      if (!changed.count) return response.status(409).json({ error: 'ALREADY_REVIEWED', message: 'Someone already reviewed this report.' })
      const report = await prisma.roadReport.findUnique({ where: { id: request.params.id } })
      await prisma.auditLog.create({ data: { actorId: request.user.id, action: `ROAD_REPORT_${parsed.data.decision}`, entityType: 'RoadReport', entityId: report.id, metadata: { kind: report.kind, area: report.area, note: parsed.data.note || null } } })
      const rider = await prisma.rider.findUnique({ where: { id: report.riderId }, select: { userId: true } })
      if (rider) await notifyUsers(prisma, [rider.userId], { type: 'DELIVERY', title: parsed.data.decision === 'APPROVED' ? 'Thanks — your road report was approved' : 'Your road report wasn’t approved', body: `${KINDS[report.kind]} · ${report.area}${parsed.data.note ? `: ${parsed.data.note}` : ''}`.slice(0, 200), link: '/rider/road-reports' })
      return response.json({ status: parsed.data.decision })
    } catch { return response.status(503).json({ error: 'REPORTS_UNAVAILABLE' }) }
  })

  // "What riders say" about an area, for pricing hard-to-map places (Prices to confirm, the price simulator).
  router.get('/admin/road-reports/suggestions', requireUser, async (request, response) => {
    const area = String(request.query.area || '').trim().slice(0, 120)
    if (area.length < 2) return response.json({ confidence: { riders: 0, level: 'NONE' }, suggestedKm: null, reports: [] })
    try {
      const rows = await prisma.roadReport.findMany({ where: { status: 'APPROVED', area: { contains: area.split(/\s+/)[0], mode: 'insensitive' } }, take: 200 })
      return response.json(suggestionsFor(rows, area))
    } catch { return response.status(503).json({ error: 'REPORTS_UNAVAILABLE' }) }
  })

  return router
}
