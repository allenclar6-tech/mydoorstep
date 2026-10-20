import express from 'express'
import { z } from 'zod'
import { BLOCKER_TEXT, deliveryBlockers, deliveryZones, EXPORT_FIELDS, FLAG_TEXT, isLocationReviewer, LOCALITY_TYPES, materialChangeEffects, pointOf, qualityFlags, reviewersRestricted, seedCandidateLocations, slug, toCsv, validatePolygon, VERIFICATION_METHODS, VERIFICATION_STATUSES, coverageContains } from './locations.js'

const lat = z.number().min(-90).max(90)
const lng = z.number().min(-180).max(180)
const text = (max) => z.string().trim().max(max)
const fail = (response, error) => {
  if (error?.status && error?.code) return response.status(error.status).json({ error: error.code, message: error.message, reasons: error.reasons })
  console.error('[locations]', error?.message)
  return response.status(503).json({ error: 'LOCATIONS_UNAVAILABLE', message: 'The location directory is temporarily unavailable.' })
}
const problem = (status, code, message, extra = {}) => Object.assign(new Error(message), { status, code, ...extra })
const num = (value) => (value == null ? null : Number(value))

function publicView(row) {
  return { ...row, latitude: num(row.latitude), longitude: num(row.longitude), referenceLatitude: num(row.referenceLatitude), referenceLongitude: num(row.referenceLongitude) }
}

export function createLocationRouter({ prisma, requireUser, requireAdmin }) {
  const router = express.Router()
  const requireReviewer = (request, response, next) => isLocationReviewer(request.user) ? next() : response.status(403).json({ error: 'LOCATION_REVIEWER_REQUIRED', message: 'Only an authorised location reviewer can do this.' })
  const requireRiderOrAdmin = (request, response, next) => ['RIDER', 'ADMIN'].includes(request.user?.role) ? next() : response.status(403).json({ error: 'FORBIDDEN' })
  const audit = (db, request, action, location, metadata = {}) => db.auditLog.create({ data: { actorId: request.user.id, action, entityType: 'Location', entityId: location.id, metadata: { name: location.name, ...metadata } } })
  const load = async (id) => { const row = await prisma.location.findUnique({ where: { id } }); if (!row) throw problem(404, 'LOCATION_NOT_FOUND', 'Location not found.'); return row }
  const evidenceOf = (row) => (Array.isArray(row.evidence) ? row.evidence : [])

  /* -------------------------------- customers -------------------------------- */
  // Areas customers can pick, with whether DOORSTEP delivers there yet. No evidence or reviewer data.
  router.get('/locations', async (_request, response) => {
    try {
      const rows = await prisma.location.findMany({ where: { isActive: true, mergedIntoId: null, NOT: { verificationStatus: 'rejected' } }, orderBy: { name: 'asc' }, take: 1000 })
      response.set('Cache-Control', 'public, max-age=120')
      return response.json({ locations: rows.map((row) => {
        const blockers = deliveryBlockers(row)
        return { id: row.id, slug: row.slug, name: row.name, alternativeNames: row.alternativeNames, type: row.localityType, parentId: row.parentId, landmark: row.nearestLandmark, delivery: { available: blockers.length === 0, message: blockers.length === 0 ? null : blockers.includes('TEMPORARILY_CLOSED') ? `Deliveries to ${row.name} are paused${row.closedReason ? `: ${row.closedReason}` : ''}.` : `DOORSTEP doesn’t deliver to ${row.name} yet.` } }
      }) })
    } catch (error) { return fail(response, error) }
  })

  /* --------------------------- local reviewers (riders) --------------------------- */
  router.get('/locations/review-queue', requireUser, requireRiderOrAdmin, async (_request, response) => {
    try {
      const rows = await prisma.location.findMany({ where: { isActive: true, mergedIntoId: null, verificationStatus: { in: ['pending', 'needs_review', 'needs_local_verification'] } }, orderBy: [{ verificationStatus: 'asc' }, { name: 'asc' }], take: 500 })
      return response.json({ locations: rows.map((row) => ({ id: row.id, name: row.name, originalCandidateName: row.originalCandidateName, alternativeNames: row.alternativeNames, type: row.localityType, latitude: num(row.latitude), longitude: num(row.longitude), status: row.verificationStatus, landmark: row.nearestLandmark, question: row.verificationNotes })) })
    } catch (error) { return fail(response, error) }
  })

  const reviewSchema = z.object({
    confirmationType: z.enum(['PHYSICAL', 'REMOTE']),
    nameConfirmed: z.boolean(),
    suggestedName: text(80).optional(),
    suggestedLatitude: lat.optional(),
    suggestedLongitude: lng.optional(),
    landmark: text(160).optional(),
    notes: text(1000).min(10, 'Describe what you checked (at least a sentence).'),
  }).refine((value) => (value.suggestedLatitude == null) === (value.suggestedLongitude == null), { message: 'Give both latitude and longitude, or neither.' })
  router.post('/locations/:id/reviews', requireUser, requireRiderOrAdmin, async (request, response) => {
    const parsed = reviewSchema.safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_REVIEW', message: parsed.error.issues[0]?.message })
    try {
      const location = await load(request.params.id)
      const review = await prisma.locationReview.create({ data: { locationId: location.id, submittedById: request.user.id, submitterRole: request.user.role, ...parsed.data } })
      await audit(prisma, request, 'LOCATION_LOCAL_REVIEW_SUBMITTED', location, { reviewId: review.id, confirmationType: parsed.data.confirmationType })
      return response.status(201).json({ review: { id: review.id, status: review.status } })
    } catch (error) { return fail(response, error) }
  })

  /* ---------------------------------- admin ---------------------------------- */
  router.get('/admin/locations', requireUser, requireAdmin, async (request, response) => {
    try {
      const rows = await prisma.location.findMany({ orderBy: [{ candidateNumber: 'asc' }, { name: 'asc' }], take: 2000 })
      const flags = qualityFlags(rows)
      const pendingReviews = await prisma.locationReview.groupBy({ by: ['locationId'], where: { status: 'SUBMITTED' }, _count: { _all: true } })
      const reviewsBy = Object.fromEntries(pendingReviews.map((row) => [row.locationId, row._count._all]))
      const summary = {
        total: rows.length,
        byStatus: Object.fromEntries(VERIFICATION_STATUSES.map((status) => [status, rows.filter((row) => row.verificationStatus === status).length])),
        withPin: rows.filter((row) => pointOf(row)).length,
        coverageApproved: rows.filter((row) => row.boundaryVerificationStatus === 'approved').length,
        deliveryZones: rows.filter((row) => deliveryBlockers(row).length === 0).length,
        merged: rows.filter((row) => row.mergedIntoId).length,
        pendingLocalReviews: pendingReviews.reduce((sum, row) => sum + row._count._all, 0),
      }
      return response.json({
        locations: rows.map((row) => ({ ...publicView(row), flags: flags[row.id], pendingReviews: reviewsBy[row.id] || 0, blockers: deliveryBlockers(row, { ignoreSwitch: true }) })),
        summary,
        reviewer: { canReview: isLocationReviewer(request.user), restricted: reviewersRestricted() },
        labels: { flags: FLAG_TEXT, blockers: BLOCKER_TEXT, methods: VERIFICATION_METHODS, statuses: VERIFICATION_STATUSES, types: LOCALITY_TYPES },
      })
    } catch (error) { return fail(response, error) }
  })

  router.get('/admin/locations/export', requireUser, requireAdmin, async (request, response) => {
    try {
      const rows = await prisma.location.findMany({ orderBy: [{ candidateNumber: 'asc' }, { name: 'asc' }] })
      const flags = qualityFlags(rows)
      const enriched = rows.map((row) => ({ ...publicView(row), qualityFlags: flags[row.id], evidenceCount: evidenceOf(row).length }))
      const stamp = new Date().toISOString().slice(0, 10)
      if (request.query.format === 'csv') {
        response.set('Content-Type', 'text/csv; charset=utf-8')
        response.set('Content-Disposition', `attachment; filename="doorstep-sapele-locations-${stamp}.csv"`)
        return response.send(`﻿${toCsv(enriched)}`)
      }
      response.set('Content-Disposition', `attachment; filename="doorstep-sapele-locations-${stamp}.json"`)
      return response.json({ exportedAt: new Date().toISOString(), fields: EXPORT_FIELDS, locations: enriched })
    } catch (error) { return fail(response, error) }
  })

  router.get('/admin/locations/:id', requireUser, requireAdmin, async (request, response) => {
    try {
      const row = await load(request.params.id)
      const [reviews, history, all] = await Promise.all([
        prisma.locationReview.findMany({ where: { locationId: row.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
        prisma.auditLog.findMany({ where: { entityType: 'Location', entityId: row.id }, orderBy: { createdAt: 'desc' }, take: 100 }),
        prisma.location.findMany({ select: { id: true, name: true, alternativeNames: true, latitude: true, longitude: true, mergedIntoId: true, verificationStatus: true, evidence: true, verificationSource: true, deliveryEnabled: true, isActive: true, boundaryVerificationStatus: true, coverageMethod: true, boundaryGeometry: true, coverageRadiusMeters: true, radiusLimitationsAcceptedById: true, closedUntil: true } }),
      ])
      return response.json({ location: { ...publicView(row), flags: qualityFlags(all)[row.id] || [], blockers: deliveryBlockers(row, { ignoreSwitch: true }) }, reviews: reviews.map(publicView), history })
    } catch (error) { return fail(response, error) }
  })

  const createSchema = z.object({ name: text(80).min(2), localityType: z.enum(LOCALITY_TYPES), parentId: z.string().max(40).nullable().optional(), alternativeNames: z.array(text(80)).max(20).default([]), latitude: lat.nullable().optional(), longitude: lng.nullable().optional(), nearestLandmark: text(160).nullable().optional(), notes: text(1000).optional(), source: text(200).optional(), sourceUrl: z.string().url().max(500).optional() })
  router.post('/admin/locations', requireUser, requireAdmin, async (request, response) => {
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_LOCATION', message: parsed.error.issues[0]?.message })
    const data = parsed.data
    if ((data.latitude == null) !== (data.longitude == null)) return response.status(400).json({ error: 'INVALID_LOCATION', message: 'Give both latitude and longitude, or neither.' })
    try {
      let base = slug(data.name); let candidate = base; let n = 2
      while (await prisma.location.findUnique({ where: { slug: candidate } })) candidate = `${base}-${n++}`
      const evidence = data.source ? [{ kind: 'NOTE', source: data.source, url: data.sourceUrl || null, checkedAt: new Date().toISOString().slice(0, 10), method: 'DESK_RESEARCH', by: request.user.id }] : []
      const row = await prisma.location.create({ data: { slug: candidate, name: data.name, localityType: data.localityType, parentId: data.parentId || null, alternativeNames: data.alternativeNames, latitude: data.latitude ?? null, longitude: data.longitude ?? null, nearestLandmark: data.nearestLandmark || null, verificationStatus: 'pending', verificationNotes: data.notes || null, verificationSource: data.source || null, verificationSourceUrl: data.sourceUrl || null, evidence } })
      await audit(prisma, request, 'LOCATION_CREATED', row, { after: data })
      return response.status(201).json({ location: publicView(row) })
    } catch (error) { return fail(response, error) }
  })

  const editSchema = z.object({ name: text(80).min(2).optional(), localityType: z.enum(LOCALITY_TYPES).optional(), parentId: z.string().max(40).nullable().optional(), alternativeNames: z.array(text(80)).max(20).optional(), latitude: lat.nullable().optional(), longitude: lng.nullable().optional(), nearestLandmark: text(160).nullable().optional(), isActive: z.boolean().optional(), customerSurchargeMinor: z.number().int().min(0).max(10_000_000).optional(), riderBonusMinor: z.number().int().min(0).max(10_000_000).optional(), minimumOrderMinor: z.number().int().min(0).max(100_000_000).nullable().optional(), closedUntil: z.string().datetime().nullable().optional(), closedReason: text(200).nullable().optional(), reason: text(500).optional() }).strict()
  router.patch('/admin/locations/:id', requireUser, requireAdmin, async (request, response) => {
    const parsed = editSchema.safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_LOCATION', message: parsed.error.issues[0]?.message })
    try {
      const before = await load(request.params.id)
      const { reason, ...patch } = parsed.data
      if ((patch.latitude === null) !== (patch.longitude === null) && (patch.latitude === null || patch.longitude === null)) throw problem(400, 'INVALID_LOCATION', 'Clear both latitude and longitude together.')
      if (patch.parentId === before.id) throw problem(400, 'INVALID_PARENT', 'A location cannot be its own parent.')
      if (patch.isActive === false) patch.deliveryEnabled = false
      const { reasons, effects } = materialChangeEffects(before, patch)
      if (patch.closedUntil !== undefined) patch.closedUntil = patch.closedUntil ? new Date(patch.closedUntil) : null
      const row = await prisma.$transaction(async (transaction) => {
        const updated = await transaction.location.update({ where: { id: before.id }, data: { ...patch, ...effects } })
        const changed = Object.fromEntries(Object.keys(patch).map((key) => [key, { from: before[key] ?? null, to: patch[key] ?? null }]))
        await audit(transaction, request, reasons.length ? 'LOCATION_EDITED_REVERIFY' : 'LOCATION_EDITED', updated, { changed, reason: reason || null, requiresReverification: reasons, effects })
        return updated
      })
      return response.json({ location: publicView(row), requiresReverification: reasons })
    } catch (error) { return fail(response, error) }
  })

  const evidenceSchema = z.object({ source: text(200).min(3), url: z.string().url().max(500).optional(), method: z.enum(Object.keys(VERIFICATION_METHODS)), note: text(1000).optional(), latitude: lat.optional(), longitude: lng.optional() })
  router.post('/admin/locations/:id/evidence', requireUser, requireAdmin, async (request, response) => {
    const parsed = evidenceSchema.safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_EVIDENCE', message: parsed.error.issues[0]?.message })
    try {
      const before = await load(request.params.id)
      const entry = { kind: 'EVIDENCE', ...parsed.data, checkedAt: new Date().toISOString().slice(0, 10), by: request.user.id }
      const row = await prisma.location.update({ where: { id: before.id }, data: { evidence: [...evidenceOf(before), entry] } })
      await audit(prisma, request, 'LOCATION_EVIDENCE_ADDED', row, { entry })
      return response.status(201).json({ location: publicView(row) })
    } catch (error) { return fail(response, error) }
  })

  const statusSchema = z.object({ status: z.enum(VERIFICATION_STATUSES), method: z.enum(Object.keys(VERIFICATION_METHODS)).optional(), notes: text(2000).min(10, 'Explain the decision in a sentence or two.'), source: text(200).optional(), sourceUrl: z.string().url().max(500).optional() })
  router.post('/admin/locations/:id/status', requireUser, requireAdmin, async (request, response) => {
    const parsed = statusSchema.safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_STATUS', message: parsed.error.issues[0]?.message })
    const { status, method, notes, source, sourceUrl } = parsed.data
    try {
      const before = await load(request.params.id)
      if (['verified', 'rejected'].includes(status) && !isLocationReviewer(request.user)) throw problem(403, 'LOCATION_REVIEWER_REQUIRED', 'Only an authorised location reviewer can verify or reject a location.')
      if (status === 'verified') {
        if (!pointOf(before)) throw problem(409, 'PIN_REQUIRED', 'Set and check the map pin before verifying.')
        if (!method || method === 'IMPORT_REFERENCE' || method === 'DESK_RESEARCH') throw problem(409, 'CHECK_REQUIRED', 'Verification needs a map review against roads and landmarks, or a local (remote or physical) confirmation — imported or single-source desk research is not enough.')
        if (!evidenceOf(before).some((entry) => entry.kind !== 'REFERENCE')) throw problem(409, 'EVIDENCE_REQUIRED', 'Record at least one piece of evidence before verifying.')
      }
      const data = { verificationStatus: status, verificationNotes: notes, verificationCheckedAt: new Date(), ...(method ? { verificationMethod: method } : {}), ...(source ? { verificationSource: source } : {}), ...(sourceUrl ? { verificationSourceUrl: sourceUrl } : {}), ...(['verified', 'rejected'].includes(status) ? { reviewerId: request.user.id } : {}), ...(status !== 'verified' ? { deliveryEnabled: false } : {}) }
      const row = await prisma.$transaction(async (transaction) => {
        const updated = await transaction.location.update({ where: { id: before.id }, data })
        await audit(transaction, request, `LOCATION_STATUS_${status.toUpperCase()}`, updated, { from: before.verificationStatus, to: status, method: method || null, notes })
        return updated
      })
      return response.json({ location: publicView(row) })
    } catch (error) { return fail(response, error) }
  })

  const coverageSchema = z.discriminatedUnion('method', [
    z.object({ method: z.literal('POLYGON'), geometry: z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(z.tuple([lng, lat]))) }), notes: text(1000).optional() }),
    z.object({ method: z.literal('RADIUS'), radiusMeters: z.number().int().min(100).max(10_000), notes: text(1000).optional() }),
  ])
  router.put('/admin/locations/:id/coverage', requireUser, requireAdmin, async (request, response) => {
    const parsed = coverageSchema.safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_COVERAGE', message: parsed.error.issues[0]?.message })
    try {
      const before = await load(request.params.id)
      if (parsed.data.method === 'POLYGON') { const issue = validatePolygon(parsed.data.geometry); if (issue) throw problem(400, 'INVALID_COVERAGE', issue) }
      if (parsed.data.method === 'RADIUS' && !pointOf(before)) throw problem(409, 'PIN_REQUIRED', 'A radius needs a centre pin.')
      const data = { coverageMethod: parsed.data.method, boundaryGeometry: parsed.data.method === 'POLYGON' ? parsed.data.geometry : null, coverageRadiusMeters: parsed.data.method === 'RADIUS' ? parsed.data.radiusMeters : null, boundaryVerificationStatus: 'needs_review', boundaryNotes: parsed.data.notes || null, boundaryApprovedById: null, boundaryApprovedAt: null, radiusLimitationsAcceptedById: null, deliveryEnabled: false, evidence: [...evidenceOf(before), { kind: 'COVERAGE_SUBMITTED', method: parsed.data.method, at: new Date().toISOString(), by: request.user.id }] }
      const row = await prisma.$transaction(async (transaction) => {
        const updated = await transaction.location.update({ where: { id: before.id }, data })
        await audit(transaction, request, 'LOCATION_COVERAGE_SUBMITTED', updated, { method: parsed.data.method, radiusMeters: data.coverageRadiusMeters, corners: parsed.data.method === 'POLYGON' ? parsed.data.geometry.coordinates[0].length - 1 : null })
        return updated
      })
      return response.json({ location: publicView(row) })
    } catch (error) { return fail(response, error) }
  })

  // Sample addresses tested against the drawn coverage; approval needs at least one inside and one outside.
  const testSchema = z.object({ samples: z.array(z.object({ label: text(120).min(2), latitude: lat, longitude: lng, expectInside: z.boolean() })).min(1).max(20) })
  router.post('/admin/locations/:id/coverage/test', requireUser, requireAdmin, async (request, response) => {
    const parsed = testSchema.safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_TEST', message: parsed.error.issues[0]?.message })
    try {
      const before = await load(request.params.id)
      if (!before.coverageMethod) throw problem(409, 'NO_COVERAGE', 'Draw the coverage first.')
      const results = parsed.data.samples.map((sample) => { const inside = coverageContains(before, sample); return { ...sample, inside, passed: inside === sample.expectInside } })
      const row = await prisma.location.update({ where: { id: before.id }, data: { evidence: [...evidenceOf(before), { kind: 'COVERAGE_TEST', at: new Date().toISOString(), by: request.user.id, results }] } })
      await audit(prisma, request, 'LOCATION_COVERAGE_TESTED', row, { results })
      return response.json({ results, location: publicView(row) })
    } catch (error) { return fail(response, error) }
  })

  const decisionSchema = z.object({ decision: z.enum(['approve', 'reject']), acceptRadiusLimitations: z.boolean().optional(), notes: text(1000).min(10, 'Explain the decision in a sentence or two.') })
  router.post('/admin/locations/:id/coverage/decision', requireUser, requireAdmin, requireReviewer, async (request, response) => {
    const parsed = decisionSchema.safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_DECISION', message: parsed.error.issues[0]?.message })
    try {
      const before = await load(request.params.id)
      if (before.boundaryVerificationStatus !== 'needs_review') throw problem(409, 'NOTHING_TO_REVIEW', 'There is no submitted coverage waiting for review.')
      let data
      if (parsed.data.decision === 'approve') {
        const evidence = evidenceOf(before)
        const submittedAt = [...evidence].reverse().find((entry) => entry.kind === 'COVERAGE_SUBMITTED')?.at || '1970-01-01'
        const tests = evidence.filter((entry) => entry.kind === 'COVERAGE_TEST' && entry.at >= submittedAt).flatMap((entry) => entry.results)
        if (!tests.some((test) => test.expectInside && test.passed) || !tests.some((test) => !test.expectInside && test.passed)) throw problem(409, 'COVERAGE_TESTS_REQUIRED', 'Test at least one real address inside and one outside this coverage (both must pass) before approving.')
        if (tests.some((test) => !test.passed)) throw problem(409, 'COVERAGE_TESTS_FAILING', 'Some sample addresses landed on the wrong side of the boundary. Fix the coverage and test again.')
        if (before.coverageMethod === 'RADIUS' && !parsed.data.acceptRadiusLimitations) throw problem(409, 'RADIUS_ACCEPTANCE_REQUIRED', 'A circle is not a real boundary. Tick that you accept its limitations, or draw a polygon instead.')
        data = { boundaryVerificationStatus: 'approved', boundaryApprovedById: request.user.id, boundaryApprovedAt: new Date(), radiusLimitationsAcceptedById: before.coverageMethod === 'RADIUS' ? request.user.id : null, boundaryNotes: parsed.data.notes }
      } else data = { boundaryVerificationStatus: 'rejected', boundaryNotes: parsed.data.notes, deliveryEnabled: false }
      const row = await prisma.$transaction(async (transaction) => {
        const updated = await transaction.location.update({ where: { id: before.id }, data })
        await audit(transaction, request, parsed.data.decision === 'approve' ? 'LOCATION_COVERAGE_APPROVED' : 'LOCATION_COVERAGE_REJECTED', updated, { notes: parsed.data.notes, method: before.coverageMethod, radiusLimitationsAccepted: Boolean(parsed.data.acceptRadiusLimitations) })
        return updated
      })
      return response.json({ location: publicView(row) })
    } catch (error) { return fail(response, error) }
  })

  router.post('/admin/locations/:id/delivery', requireUser, requireAdmin, async (request, response) => {
    const parsed = z.object({ enabled: z.boolean(), reason: text(500).optional() }).safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_REQUEST' })
    try {
      const before = await load(request.params.id)
      if (parsed.data.enabled) {
        if (!isLocationReviewer(request.user)) throw problem(403, 'LOCATION_REVIEWER_REQUIRED', 'Only an authorised location reviewer can switch on deliveries for an area.')
        const blockers = deliveryBlockers(before, { ignoreSwitch: true })
        if (blockers.length) throw problem(409, 'NOT_ELIGIBLE', blockers.map((code) => BLOCKER_TEXT[code]).join(' '), { reasons: blockers })
      }
      const row = await prisma.$transaction(async (transaction) => {
        const updated = await transaction.location.update({ where: { id: before.id }, data: { deliveryEnabled: parsed.data.enabled } })
        await audit(transaction, request, parsed.data.enabled ? 'LOCATION_DELIVERY_ENABLED' : 'LOCATION_DELIVERY_DISABLED', updated, { reason: parsed.data.reason || null })
        return updated
      })
      return response.json({ location: publicView(row) })
    } catch (error) { return fail(response, error) }
  })

  router.post('/admin/locations/:id/merge', requireUser, requireAdmin, requireReviewer, async (request, response) => {
    const parsed = z.object({ intoId: z.string().min(1).max(40), confirm: z.literal(true), notes: text(1000).min(10, 'Explain why these are the same place.') }).safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_MERGE', message: parsed.error.issues[0]?.message || 'Confirm the merge.' })
    try {
      const from = await load(request.params.id)
      const into = await load(parsed.data.intoId)
      if (from.id === into.id || into.mergedIntoId) throw problem(409, 'INVALID_MERGE', 'Choose a different, active record to merge into.')
      const names = [...new Set([...(into.alternativeNames || []), from.name, from.originalCandidateName, ...(from.alternativeNames || [])].filter((value) => value && value !== into.name))]
      await prisma.$transaction(async (transaction) => {
        await transaction.location.update({ where: { id: into.id }, data: { alternativeNames: names, evidence: [...evidenceOf(into), { kind: 'MERGE', source: `Merged from "${from.name}" (${from.slug})`, note: parsed.data.notes, at: new Date().toISOString(), by: request.user.id, mergedEvidence: evidenceOf(from) }] } })
        await transaction.location.update({ where: { id: from.id }, data: { mergedIntoId: into.id, isActive: false, deliveryEnabled: false } })
        await transaction.location.updateMany({ where: { parentId: from.id }, data: { parentId: into.id } })
        await audit(transaction, request, 'LOCATION_MERGED', from, { into: { id: into.id, name: into.name }, notes: parsed.data.notes })
        await audit(transaction, request, 'LOCATION_MERGE_TARGET', into, { from: { id: from.id, name: from.name }, notes: parsed.data.notes })
      })
      return response.json({ merged: true })
    } catch (error) { return fail(response, error) }
  })

  router.post('/admin/location-reviews/:reviewId/decision', requireUser, requireAdmin, requireReviewer, async (request, response) => {
    const parsed = z.object({ decision: z.enum(['accept', 'decline']), applyPin: z.boolean().default(false), applyName: z.boolean().default(false), note: text(1000).optional() }).safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_DECISION' })
    try {
      const review = await prisma.locationReview.findUnique({ where: { id: request.params.reviewId } })
      if (!review || review.status !== 'SUBMITTED') throw problem(404, 'REVIEW_NOT_FOUND', 'This review was already handled.')
      const before = await load(review.locationId)
      await prisma.$transaction(async (transaction) => {
        await transaction.locationReview.update({ where: { id: review.id }, data: { status: parsed.data.decision === 'accept' ? 'ACCEPTED' : 'DECLINED', decidedById: request.user.id, decidedAt: new Date(), decisionNote: parsed.data.note || null } })
        if (parsed.data.decision === 'accept') {
          const patch = {}
          if (parsed.data.applyPin && review.suggestedLatitude != null) Object.assign(patch, { latitude: Number(review.suggestedLatitude), longitude: Number(review.suggestedLongitude) })
          if (parsed.data.applyName && review.suggestedName) Object.assign(patch, { name: review.suggestedName, alternativeNames: [...new Set([...(before.alternativeNames || []), before.name])] })
          if (review.landmark && !before.nearestLandmark) patch.nearestLandmark = review.landmark
          const { effects } = materialChangeEffects(before, patch)
          const entry = { kind: 'LOCAL_CONFIRMATION', method: review.confirmationType === 'PHYSICAL' ? 'PHYSICAL_FIELD_CHECK' : 'REMOTE_LOCAL_CONFIRMATION', source: `Local review by ${review.submitterRole.toLowerCase()} ${review.submittedById}`, note: review.notes, nameConfirmed: review.nameConfirmed, suggestedName: review.suggestedName, latitude: review.suggestedLatitude != null ? Number(review.suggestedLatitude) : null, longitude: review.suggestedLongitude != null ? Number(review.suggestedLongitude) : null, landmark: review.landmark, at: review.createdAt, acceptedBy: request.user.id }
          const statusMove = before.verificationStatus === 'needs_local_verification' || before.verificationStatus === 'pending' ? { verificationStatus: 'needs_review' } : {}
          const updated = await transaction.location.update({ where: { id: before.id }, data: { ...patch, ...effects, ...statusMove, evidence: [...evidenceOf(before), entry] } })
          await audit(transaction, request, 'LOCATION_LOCAL_REVIEW_ACCEPTED', updated, { reviewId: review.id, applied: Object.keys(patch), effects })
        } else await audit(transaction, request, 'LOCATION_LOCAL_REVIEW_DECLINED', before, { reviewId: review.id, note: parsed.data.note || null })
      })
      return response.json({ done: true })
    } catch (error) { return fail(response, error) }
  })

  router.get('/admin/location-reviews', requireUser, requireAdmin, async (_request, response) => {
    try {
      const reviews = await prisma.locationReview.findMany({ where: { status: 'SUBMITTED' }, include: { location: { select: { id: true, name: true, latitude: true, longitude: true, verificationStatus: true } } }, orderBy: { createdAt: 'asc' }, take: 200 })
      return response.json({ reviews: reviews.map((review) => ({ ...publicView(review), location: publicView(review.location) })) })
    } catch (error) { return fail(response, error) }
  })

  router.post('/admin/locations/seed', requireUser, requireAdmin, async (request, response) => {
    try {
      const result = await seedCandidateLocations(prisma)
      await prisma.auditLog.create({ data: { actorId: request.user.id, action: 'LOCATION_CANDIDATES_SEEDED', entityType: 'Location', entityId: 'seed', metadata: result } })
      return response.json(result)
    } catch (error) { return fail(response, error) }
  })

  // Which approved delivery zone (if any) a customer pin falls in — for checking assignments by hand.
  router.post('/admin/locations/check-address', requireUser, requireAdmin, async (request, response) => {
    const parsed = z.object({ latitude: lat, longitude: lng }).safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_POINT' })
    try {
      const zones = await deliveryZones(prisma)
      const matches = zones.filter((zone) => coverageContains(zone, parsed.data))
      return response.json({ matches: matches.map((zone) => ({ id: zone.locationId, name: zone.name, closed: zone.closed })), approvedZones: zones.length })
    } catch (error) { return fail(response, error) }
  })

  return router
}
