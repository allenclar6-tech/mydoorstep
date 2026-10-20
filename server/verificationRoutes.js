import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { BUSINESS_STATUS_LABELS, decideBusinessVerification, initialBusinessVerification, VerificationRuleError } from './businessVerification.js'
import { checkBusinessRegistration, checkRiderIdentity, RegistryError, registryProvider } from './registryChecks.js'
import { notifyAdmins, notifyUsers, restaurantTeamIds } from './notify.js'

const MAX_DOCUMENTS_PER_APPLICATION = 15

/**
 * Business-registration verification, registry checks and document resubmission.
 * Admin routes are protected server-side by requireUser + requireAdmin; applicants authenticate
 * with their account email and password (they cannot sign in to a workspace until approved).
 */
export function createVerificationRouter({ prisma, requireUser, requireAdmin, upload, storeApplicationDocuments, verifyPassword, fetchImpl }) {
  const router = Router()
  const applicantLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, handler: (_request, response) => response.status(429).json({ error: 'AUTH_RATE_LIMITED' }) })
  const checkLimiter = rateLimit({ windowMs: 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, handler: (_request, response) => response.status(429).json({ error: 'REGISTRY_RATE_LIMITED' }) })

  const fail = (response, error, fallback = 'VERIFICATION_SERVICE_UNAVAILABLE') => {
    if (error instanceof RegistryError || error instanceof VerificationRuleError) return response.status(error.status).json({ error: error.code, message: error.message })
    if (error?.code && error?.status) return response.status(error.status).json({ error: error.code, message: error.message })
    console.error('[verification] unexpected_failure', JSON.stringify({ name: error?.name, code: error?.code }))
    return response.status(503).json({ error: fallback })
  }

  const subjectFor = (type) => type === 'rider' ? 'RIDER_APPLICATION' : 'RESTAURANT_APPLICATION'

  async function loadBusinessApplication(id) {
    return prisma.restaurantApplication.findUnique({ where: { id }, include: { restaurant: { select: { id: true, name: true, storeType: true } }, documents: { select: { id: true, type: true } } } })
  }

  // Which automatic checks are available (shown in admin settings and next to each application).
  router.get('/admin/verification/providers', requireUser, requireAdmin, (_request, response) => {
    const provider = registryProvider()
    response.json({ registry: provider ? { name: 'Ninja (ninja.ng)', mode: provider.mode, checks: ['CAC company lookup', 'NIN / driver’s licence / passport / voter’s card match'] } : null })
  })

  router.get('/admin/applications/:type/:applicationId/checks', requireUser, requireAdmin, async (request, response) => {
    if (!['restaurant', 'grocery', 'rider'].includes(request.params.type)) return response.status(400).json({ error: 'INVALID_APPLICATION_TYPE' })
    try {
      const checks = await prisma.verificationCheck.findMany({ where: { subjectType: subjectFor(request.params.type), subjectId: request.params.applicationId }, orderBy: { createdAt: 'desc' }, take: 20 })
      const audit = await prisma.auditLog.findMany({ where: { entityId: request.params.applicationId, action: { startsWith: 'BUSINESS_VERIFICATION_' } }, orderBy: { createdAt: 'desc' }, take: 20, select: { action: true, metadata: true, createdAt: true, actor: { select: { firstName: true, lastName: true } } } }).catch(() => [])
      return response.json({ checks, audit })
    } catch (error) { return fail(response, error) }
  })

  // Runs a registry check. The result is advice for the reviewer; it changes no status by itself.
  router.post('/admin/applications/:type/:applicationId/registry-check', requireUser, requireAdmin, checkLimiter, async (request, response) => {
    const { type, applicationId } = request.params
    if (!['restaurant', 'grocery', 'rider'].includes(type)) return response.status(400).json({ error: 'INVALID_APPLICATION_TYPE' })
    try {
      let result
      if (type === 'rider') {
        const application = await prisma.riderApplication.findUnique({ where: { id: applicationId }, include: { rider: { include: { user: { select: { firstName: true, lastName: true, dateOfBirth: true } } } } } })
        if (!application) return response.status(404).json({ error: 'APPLICATION_NOT_FOUND' })
        if (!application.identityCheckConsentAt) return response.status(409).json({ error: 'CONSENT_REQUIRED', message: 'This rider has not consented to an automatic ID check. Review their documents manually or ask them to resubmit with consent.' })
        const user = application.rider.user
        result = await checkRiderIdentity({ identityType: application.identityType, identityNumber: application.identityNumber, firstName: user.firstName, lastName: user.lastName, dateOfBirth: user.dateOfBirth, reference: `rider-${application.id}` }, { fetchImpl })
      } else {
        const application = await loadBusinessApplication(applicationId)
        if (!application) return response.status(404).json({ error: 'APPLICATION_NOT_FOUND' })
        if (application.registrationType !== 'REGISTERED') return response.status(409).json({ error: 'NOT_A_REGISTERED_BUSINESS', message: 'This business applied as not registered, so there is nothing to look up.' })
        result = await checkBusinessRegistration({ registrationNumber: application.registrationNumber, businessName: application.restaurant.name, reference: `business-${application.id}` }, { fetchImpl })
      }
      const check = await prisma.verificationCheck.create({ data: { subjectType: subjectFor(type), subjectId: applicationId, provider: `${result.provider}:${result.mode}`, checkType: type === 'rider' ? 'ID_VERIFY' : 'CAC_LOOKUP', outcome: result.outcome, summary: result.summary, providerReference: result.providerReference, actorId: request.user.id } })
      await prisma.auditLog.create({ data: { actorId: request.user.id, action: `REGISTRY_CHECK_${check.checkType}`, entityType: type === 'rider' ? 'RiderApplication' : 'RestaurantApplication', entityId: applicationId, metadata: { outcome: result.outcome, provider: check.provider } } })
      return response.status(201).json({ check })
    } catch (error) { return fail(response, error) }
  })

  router.post('/admin/applications/:type/:applicationId/business-verification', requireUser, requireAdmin, async (request, response) => {
    if (!['restaurant', 'grocery'].includes(request.params.type)) return response.status(400).json({ error: 'INVALID_APPLICATION_TYPE' })
    const body = z.object({ decision: z.enum(['VERIFIED', 'ACTION_REQUIRED', 'REJECTED', 'NON_REGISTERED']), note: z.string().trim().max(1000).optional(), reviewedCertificate: z.boolean().optional() }).safeParse(request.body)
    if (!body.success) return response.status(400).json({ error: 'INVALID_BUSINESS_DECISION' })
    try {
      const application = await loadBusinessApplication(request.params.applicationId)
      if (!application) return response.status(404).json({ error: 'APPLICATION_NOT_FOUND' })
      const hasCertificate = application.documents.some((document) => document.type === 'BUSINESS_REGISTRATION')
      const latestCheck = await prisma.verificationCheck.findFirst({ where: { subjectType: 'RESTAURANT_APPLICATION', subjectId: application.id, checkType: 'CAC_LOOKUP' }, orderBy: { createdAt: 'desc' } })
      const update = decideBusinessVerification(application, body.data, { hasCertificate, hasRegistryMatch: latestCheck?.outcome === 'MATCH', reviewedCertificate: body.data.reviewedCertificate === true })
      const updated = await prisma.$transaction(async (transaction) => {
        const saved = await transaction.restaurantApplication.update({ where: { id: application.id }, data: { ...update, businessVerifiedAt: update.businessVerificationStatus === 'VERIFIED' ? new Date() : null, businessVerifiedById: request.user.id } })
        await transaction.auditLog.create({ data: { actorId: request.user.id, action: `BUSINESS_VERIFICATION_${update.businessVerificationStatus}`, entityType: 'RestaurantApplication', entityId: application.id, metadata: { previous: application.businessVerificationStatus, note: update.businessVerificationNote || null, evidence: latestCheck?.outcome === 'MATCH' ? 'registry_match' : body.data.reviewedCertificate ? 'certificate_reviewed' : null } } })
        const label = BUSINESS_STATUS_LABELS[update.businessVerificationStatus]
        await notifyUsers(transaction, await restaurantTeamIds(transaction, application.restaurantId), {
          type: 'ACCOUNT',
          title: update.businessVerificationStatus === 'VERIFIED' ? 'Registered business verified' : `Business registration: ${label.toLowerCase()}`,
          body: update.businessVerificationStatus === 'VERIFIED' ? `${application.restaurant.name} now shows as a verified registered business.` : `${application.restaurant.name}: ${update.businessVerificationNote}`,
          link: '/partner/application-status',
        })
        return saved
      })
      return response.json({ application: { id: updated.id, registrationType: updated.registrationType, businessVerificationStatus: updated.businessVerificationStatus, businessVerificationNote: updated.businessVerificationNote, businessVerifiedAt: updated.businessVerifiedAt } })
    } catch (error) { return fail(response, error) }
  })

  // Applicants add documents (and, for businesses, registration details) after being asked for more.
  router.post('/application-status/documents', applicantLimiter, upload.fields([{ name: 'documents', maxCount: 5 }, { name: 'registrationCertificate', maxCount: 1 }]), async (request, response) => {
    const body = z.object({
      email: z.string().email().transform((value) => value.toLowerCase()),
      password: z.string().min(1).max(200),
      registrationType: z.enum(['REGISTERED', 'NOT_REGISTERED']).optional(),
      registrationNumber: z.string().trim().max(40).optional(),
      identityCheckConsent: z.union([z.literal('on'), z.literal('true')]).optional(),
    }).safeParse(request.body)
    if (!body.success) return response.status(400).json({ error: 'INVALID_RESUBMISSION' })
    try {
      const user = await prisma.user.findUnique({ where: { email: body.data.email }, include: { rider: { include: { application: { include: { identityDocuments: { select: { id: true } } } } } }, restaurantUsers: { include: { restaurant: { include: { application: { include: { documents: { select: { id: true } } } } } } } } } })
      const passwordOk = await verifyPassword(body.data.password, user?.passwordHash || null)
      if (!user || !passwordOk || user.status !== 'ACTIVE') return response.status(401).json({ error: 'INVALID_CREDENTIALS' })
      const files = request.files || {}
      const extra = files.documents || []
      const certificate = files.registrationCertificate?.[0] || null

      if (user.role === 'RIDER' && user.rider?.application) {
        const application = user.rider.application
        if (!extra.length && !body.data.identityCheckConsent) return response.status(400).json({ error: 'NOTHING_TO_SUBMIT', message: 'Choose at least one document to upload.' })
        if (application.identityDocuments.length + extra.length > MAX_DOCUMENTS_PER_APPLICATION) return response.status(400).json({ error: 'TOO_MANY_DOCUMENTS' })
        const stored = await storeApplicationDocuments(extra, { firstType: 'IDENTITY' })
        await prisma.$transaction(async (transaction) => {
          if (stored.length) await transaction.riderIdentityDocument.createMany({ data: stored.map((document) => ({ applicationId: application.id, type: document.type, storageKey: document.storageKey })) })
          const reopen = application.status === 'NEEDS_INFORMATION'
          await transaction.riderApplication.update({ where: { id: application.id }, data: { ...(reopen ? { status: 'PENDING_APPROVAL' } : {}), ...(body.data.identityCheckConsent ? { identityCheckConsentAt: new Date() } : {}) } })
          if (reopen) {
            await transaction.rider.update({ where: { id: user.rider.id }, data: { status: 'PENDING_APPROVAL' } })
            await transaction.applicationReview.create({ data: { applicationType: 'RIDER', applicationId: application.id, previousStatus: 'NEEDS_INFORMATION', status: 'PENDING_APPROVAL', note: `Rider uploaded ${stored.length} document(s).` } })
          }
          await notifyAdmins(transaction, { type: 'ACCOUNT', title: 'Rider sent more documents', body: `${user.firstName} ${user.lastName} uploaded ${stored.length} document(s) for review.`, link: '/admin/riders' })
        })
        return response.status(201).json({ uploaded: stored.length })
      }

      const membership = user.restaurantUsers.find(({ restaurant }) => restaurant.application)
      if (user.role !== 'RESTAURANT' || !membership) return response.status(404).json({ error: 'APPLICATION_NOT_FOUND' })
      const application = membership.restaurant.application
      if (!extra.length && !certificate && !body.data.registrationType) return response.status(400).json({ error: 'NOTHING_TO_SUBMIT', message: 'Choose a document or update your registration details.' })
      if (application.documents.length + extra.length + (certificate ? 1 : 0) > MAX_DOCUMENTS_PER_APPLICATION) return response.status(400).json({ error: 'TOO_MANY_DOCUMENTS' })
      if (application.businessVerificationStatus === 'VERIFIED' && body.data.registrationType) return response.status(409).json({ error: 'ALREADY_VERIFIED', message: 'Your registration is already verified. Contact support to change it.' })
      const stored = [
        ...(await storeApplicationDocuments(extra, { firstType: 'BUSINESS_OR_VEHICLE' })),
        ...(certificate ? (await storeApplicationDocuments([certificate], { firstType: 'BUSINESS_REGISTRATION' })) : []),
      ]
      const registrationType = body.data.registrationType || (certificate ? 'REGISTERED' : null)
      await prisma.$transaction(async (transaction) => {
        if (stored.length) await transaction.restaurantDocument.createMany({ data: stored.map((document) => ({ applicationId: application.id, type: document.type, storageKey: document.storageKey })) })
        const hasCertificate = Boolean(certificate) || await transaction.restaurantDocument.count({ where: { applicationId: application.id, type: 'BUSINESS_REGISTRATION' } }) > 0
        const registration = registrationType ? initialBusinessVerification({ registrationType, registrationNumber: body.data.registrationNumber || application.registrationNumber, hasCertificate }) : null
        const reopen = application.status === 'NEEDS_INFORMATION'
        await transaction.restaurantApplication.update({ where: { id: application.id }, data: {
          ...(registration ? { ...registration, registrationNumber: registrationType === 'REGISTERED' ? (body.data.registrationNumber || application.registrationNumber) : application.registrationNumber, businessVerifiedAt: null } : {}),
          ...(reopen ? { status: 'PENDING_APPROVAL' } : {}),
        } })
        if (reopen) {
          await transaction.restaurant.update({ where: { id: membership.restaurant.id }, data: { status: 'PENDING_APPROVAL' } })
          await transaction.applicationReview.create({ data: { applicationType: 'RESTAURANT', applicationId: application.id, previousStatus: 'NEEDS_INFORMATION', status: 'PENDING_APPROVAL', note: `Business uploaded ${stored.length} document(s).` } })
        }
        await notifyAdmins(transaction, { type: 'ACCOUNT', title: `${membership.restaurant.name} sent an update`, body: [stored.length ? `${stored.length} new document(s)` : null, registration ? `registration: ${BUSINESS_STATUS_LABELS[registration.businessVerificationStatus].toLowerCase()}` : null].filter(Boolean).join(' · '), link: membership.restaurant.storeType === 'GROCERY' ? '/admin/groceries' : '/admin/restaurants' })
      })
      return response.status(201).json({ uploaded: stored.length })
    } catch (error) { return fail(response, error, 'RESUBMISSION_UNAVAILABLE') }
  })

  return router
}
