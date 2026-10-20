import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { profileCompleteness } from './profileCompleteness.js'
import { googleSignInEnabled, GoogleAuthError, verifyGoogleIdToken } from './googleAuth.js'
import { LinkingError, linkGoogle, resolveGoogleSignIn, resolvePhoneSignIn, unlinkGoogle } from './accountLinking.js'
import { emailConfigured, issueVerificationCode, smsConfigured, verificationFailure, verifyCode, whatsappConfigured } from './verificationService.js'

const e164 = z.string().trim().regex(/^\+[1-9]\d{7,14}$/, 'Use the international format, e.g. +2348012345678')

/**
 * Sign-in routes beyond email + password: Google, phone codes (SMS / WhatsApp) and linking.
 * Each method is offered only when its provider is configured on the server.
 */
export function createAuthRouter({ prisma, requireUser, createSession, publicUser, sendWelcome, fetchImpl }) {
  const router = Router()
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, handler: (_request, response) => response.status(429).json({ error: 'AUTH_RATE_LIMITED' }) })

  const fail = (response, error, fallback = 'AUTH_SERVICE_UNAVAILABLE') => {
    if (error instanceof GoogleAuthError || error instanceof LinkingError) return response.status(error.status).json({ error: error.code, message: error.message })
    if (error?.code === 'P2002') return response.status(409).json({ error: 'ACCOUNT_ALREADY_EXISTS', message: 'An account with these details already exists.' })
    console.error('[auth] unexpected_failure', JSON.stringify({ name: error?.name, code: error?.code }))
    return response.status(503).json({ error: fallback })
  }

  // What the sign-in screens may show. Public: contains only the Google client ID, which is public by design.
  router.get('/auth/providers', (_request, response) => {
    response.set('Cache-Control', 'public, max-age=300')
    response.json({
      email: emailConfigured(),
      google: googleSignInEnabled() ? { clientId: String(process.env.GOOGLE_CLIENT_ID).split(',')[0].trim() } : null,
      phone: { sms: smsConfigured(), whatsapp: whatsappConfigured() },
    })
  })

  router.post('/auth/google', limiter, async (request, response) => {
    const body = z.object({ credential: z.string().min(20).max(4096), termsAccepted: z.boolean().optional() }).safeParse(request.body)
    if (!body.success) return response.status(400).json({ error: 'GOOGLE_TOKEN_INVALID' })
    try {
      const identity = await verifyGoogleIdToken(body.data.credential, { fetchImpl })
      const { user, created, linked } = await prisma.$transaction((transaction) => resolveGoogleSignIn(transaction, identity, { termsAccepted: body.data.termsAccepted === true }))
      if (created) await sendWelcome(prisma, user).catch(() => undefined)
      if (linked) await prisma.auditLog.create({ data: { actorId: user.id, action: 'GOOGLE_LINKED_ON_SIGN_IN', entityType: 'User', entityId: user.id } }).catch(() => undefined)
      const token = await createSession(user.id)
      return response.status(created ? 201 : 200).json({ token, user: publicUser(user), created, linked })
    } catch (error) { return fail(response, error) }
  })

  router.get('/account/completeness', requireUser, async (request, response) => {
    try { return response.json(await profileCompleteness(prisma, request.user)) } catch (error) { return fail(response, error) }
  })

  router.get('/auth/identities', requireUser, async (request, response) => {
    try {
      const identities = await prisma.authIdentity.findMany({ where: { userId: request.user.id }, select: { provider: true, email: true, createdAt: true, lastUsedAt: true } })
      return response.json({
        identities,
        hasPassword: Boolean(request.user.passwordHash),
        email: { address: request.user.email, verified: Boolean(request.user.emailVerifiedAt) },
        phone: request.user.phone ? { number: request.user.phone, verified: Boolean(request.user.phoneVerifiedAt) } : null,
      })
    } catch (error) { return fail(response, error) }
  })

  router.post('/auth/google/link', requireUser, limiter, async (request, response) => {
    const body = z.object({ credential: z.string().min(20).max(4096) }).safeParse(request.body)
    if (!body.success) return response.status(400).json({ error: 'GOOGLE_TOKEN_INVALID' })
    try {
      const identity = await verifyGoogleIdToken(body.data.credential, { fetchImpl })
      const result = await prisma.$transaction((transaction) => linkGoogle(transaction, request.user, identity))
      if (result.linked) await prisma.auditLog.create({ data: { actorId: request.user.id, action: 'GOOGLE_LINKED', entityType: 'User', entityId: request.user.id } }).catch(() => undefined)
      return response.json(result)
    } catch (error) { return fail(response, error) }
  })

  router.delete('/auth/google/link', requireUser, async (request, response) => {
    try {
      const result = await unlinkGoogle(prisma, request.user)
      if (result.unlinked) await prisma.auditLog.create({ data: { actorId: request.user.id, action: 'GOOGLE_UNLINKED', entityType: 'User', entityId: request.user.id } }).catch(() => undefined)
      return response.json(result)
    } catch (error) { return fail(response, error) }
  })

  // Phone-code sign-in. Step 1: send a code by SMS or WhatsApp.
  router.post('/auth/phone/start', limiter, async (request, response) => {
    const body = z.object({ phone: e164, channel: z.enum(['sms', 'whatsapp']).default('sms') }).safeParse(request.body)
    if (!body.success) return response.status(400).json({ error: 'INVALID_PHONE', message: body.error.issues[0]?.message })
    const channel = body.data.channel === 'whatsapp' ? 'whatsapp' : 'phone'
    if (channel === 'whatsapp' ? !whatsappConfigured() : !smsConfigured()) return response.status(503).json({ error: channel === 'whatsapp' ? 'WHATSAPP_VERIFICATION_NOT_CONFIGURED' : 'SMS_VERIFICATION_NOT_CONFIGURED' })
    try {
      const challenge = await issueVerificationCode({ destination: body.data.phone, channel })
      return response.status(201).json(challenge)
    } catch (error) {
      const failure = verificationFailure(error)
      return response.status(failure.status).json({ error: failure.code, ...(failure.retryAfterSeconds ? { retryAfterSeconds: failure.retryAfterSeconds } : {}) })
    }
  })

  // Step 2: check the code. Known verified numbers are signed in; new numbers get a verificationId to finish sign-up.
  router.post('/auth/phone/verify', limiter, async (request, response) => {
    const body = z.object({ phone: e164, challengeId: z.string().min(1).max(64), code: z.string().regex(/^\d{6}$/) }).safeParse(request.body)
    if (!body.success) return response.status(400).json({ error: 'INVALID_VERIFICATION_CODE' })
    try {
      const valid = await verifyCode({ challengeId: body.data.challengeId, destination: body.data.phone, code: body.data.code, channels: ['phone', 'whatsapp'] })
      if (!valid) return response.status(400).json({ error: 'INVALID_OR_EXPIRED_CODE', message: 'That code is wrong or has expired. Request a new one.' })
      const user = await resolvePhoneSignIn(prisma, body.data.phone)
      if (!user) return response.json({ signedIn: false, verificationId: body.data.challengeId, phone: body.data.phone })
      // Consume the challenge so it cannot also be used to register another account.
      await prisma.verificationCode.update({ where: { id: body.data.challengeId }, data: { attempts: 99 } })
      const token = await createSession(user.id)
      return response.json({ signedIn: true, token, user: publicUser(user) })
    } catch (error) { return fail(response, error) }
  })

  // Signed-in users confirm (or change) their phone number or confirm their email with a code.
  router.post('/auth/contact/start', requireUser, limiter, async (request, response) => {
    const body = z.object({ kind: z.enum(['phone', 'email']), phone: e164.optional(), channel: z.enum(['sms', 'whatsapp']).default('sms') }).safeParse(request.body)
    if (!body.success) return response.status(400).json({ error: 'INVALID_PHONE', message: body.error.issues[0]?.message })
    try {
      if (body.data.kind === 'email') {
        if (request.user.emailVerifiedAt) return response.status(409).json({ error: 'ALREADY_VERIFIED' })
        if (!emailConfigured()) return response.status(503).json({ error: 'EMAIL_VERIFICATION_NOT_CONFIGURED' })
        return response.status(201).json(await issueVerificationCode({ destination: request.user.email, channel: 'email' }))
      }
      const phone = body.data.phone || request.user.phone
      if (!phone) return response.status(400).json({ error: 'INVALID_PHONE', message: 'Enter your phone number.' })
      const channel = body.data.channel === 'whatsapp' ? 'whatsapp' : 'phone'
      if (channel === 'whatsapp' ? !whatsappConfigured() : !smsConfigured()) return response.status(503).json({ error: channel === 'whatsapp' ? 'WHATSAPP_VERIFICATION_NOT_CONFIGURED' : 'SMS_VERIFICATION_NOT_CONFIGURED' })
      const taken = await prisma.user.findFirst({ where: { phone, NOT: { id: request.user.id } }, select: { id: true } })
      if (taken) return response.status(409).json({ error: 'PHONE_IN_USE', message: 'This number is already used by another DOORSTEP account.' })
      return response.status(201).json({ ...(await issueVerificationCode({ destination: phone, channel })), phone })
    } catch (error) {
      const failure = verificationFailure(error)
      return response.status(failure.status).json({ error: failure.code, ...(failure.retryAfterSeconds ? { retryAfterSeconds: failure.retryAfterSeconds } : {}) })
    }
  })

  router.post('/auth/contact/confirm', requireUser, limiter, async (request, response) => {
    const body = z.object({ kind: z.enum(['phone', 'email']), phone: e164.optional(), challengeId: z.string().min(1).max(64), code: z.string().regex(/^\d{6}$/) }).safeParse(request.body)
    if (!body.success) return response.status(400).json({ error: 'INVALID_VERIFICATION_CODE' })
    try {
      const destination = body.data.kind === 'email' ? request.user.email : (body.data.phone || request.user.phone || '')
      const valid = await verifyCode({ challengeId: body.data.challengeId, destination, code: body.data.code, channels: body.data.kind === 'email' ? ['email'] : ['phone', 'whatsapp'] })
      if (!valid) return response.status(400).json({ error: 'INVALID_OR_EXPIRED_CODE', message: 'That code is wrong or has expired. Request a new one.' })
      await prisma.verificationCode.update({ where: { id: body.data.challengeId }, data: { attempts: 99 } })
      const user = await prisma.user.update({ where: { id: request.user.id }, data: body.data.kind === 'email' ? { emailVerifiedAt: new Date() } : { phone: destination, phoneVerifiedAt: new Date() } })
      await prisma.auditLog.create({ data: { actorId: user.id, action: body.data.kind === 'email' ? 'EMAIL_VERIFIED' : 'PHONE_VERIFIED', entityType: 'User', entityId: user.id } }).catch(() => undefined)
      return response.json({ verified: true, user: publicUser(user) })
    } catch (error) { return fail(response, error) }
  })

  return router
}
