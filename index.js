import dotenv from 'dotenv'
dotenv.config({ override: true })
import { randomUUID } from 'node:crypto'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import multer from 'multer'
import { z } from 'zod'
import { prisma } from './prisma.js'
import { createSession, hashPassword, requireUser, revokeSession, revokeUserSessions, verifyPassword } from './auth.js'
import { initializePayment, isOrderPayable, matchesPaystackPayment, PaymentError, verifyWebhookSignature } from './paymentService.js'
import { advanceDelivery, claimDelivery, recordLocation } from './deliveryService.js'
import { requireAdmin, reviewApplication } from './adminService.js'
import { storePrivateDocument, uploadError } from './uploadService.js'
import { issueVerificationCode, verifyCode } from './verificationService.js'
import { buildAiReply } from './aiBrain.js'

const app = express()
const port = Number(process.env.API_PORT || 4000)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } })
const authFlowLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false })
const publicTrackingLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false })
const onboardingLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false })

app.use(helmet())
app.use(cors({ origin: (origin, callback) => {
  if (!origin || origin === process.env.WEB_ORIGIN || (process.env.NODE_ENV !== 'production' && /^http:\/\/localhost:517[3-9]$/.test(origin))) return callback(null, true)
  return callback(Object.assign(new Error('CORS origin not allowed'), { code: 'CORS_ORIGIN_DENIED' }))
} }))
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }))
app.use(express.json({ limit: '1mb', verify: (request, _response, buffer) => { request.rawBody = buffer } }))
app.use('/api', (request, response, next) => { if (request.method !== 'GET' || request.headers.authorization) response.set('Cache-Control', 'no-store'); next() })

app.get('/api/health', (_request, response) => {
  response.json({ service: 'doorstep-api', status: 'ok', environment: process.env.NODE_ENV || 'development' })
})

app.get('/api/ready', async (_request, response) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    return response.json({ service: 'doorstep-api', status: 'ready', database: 'ok' })
  } catch {
    return response.status(503).json({ service: 'doorstep-api', status: 'not_ready', database: 'unavailable' })
  }
})

app.get('/api/health/database', async (_request, response) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    return response.json({ service: 'doorstep-api', database: 'ok' })
  } catch {
    return response.status(503).json({ service: 'doorstep-api', database: 'unavailable' })
  }
})

app.get('/api', (_request, response) => {
  response.json({ name: 'DOORSTEP API', version: '0.1.0', market: 'Sapele, Delta State, Nigeria' })
})

app.get('/api/service-areas', async (_request, response) => {
  try {
    const serviceAreas = await prisma.serviceArea.findMany({ where: { enabled: true }, include: { country: true, state: true, city: true }, orderBy: { createdAt: 'asc' } })
    response.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
    return response.json({ serviceAreas: serviceAreas.map((area) => ({ id: area.id, country: area.country.name, state: area.state.name, city: area.city.name, currency: area.currency, timezone: area.timezone })) })
  } catch { return response.status(503).json({ error: 'SERVICE_AREA_SERVICE_UNAVAILABLE' }) }
})

app.get('/api/restaurants', async (request, response) => {
  const result = z.object({ search: z.string().max(100).optional(), limit: z.coerce.number().int().min(1).max(50).default(24) }).safeParse(request.query)
  if (!result.success) return response.status(400).json({ error: 'INVALID_RESTAURANT_QUERY' })
  try {
    const restaurants = await prisma.restaurant.findMany({ where: { status: 'APPROVED', ...(result.data.search ? { OR: [{ name: { contains: result.data.search, mode: 'insensitive' } }, { description: { contains: result.data.search, mode: 'insensitive' } }] } : {}) }, include: { city: true, categories: { include: { items: { where: { available: true }, take: 6 } } } }, orderBy: { ratingAverage: 'desc' }, take: result.data.limit })
    return response.json({ restaurants: restaurants.map((restaurant) => ({ id: restaurant.id, name: restaurant.name, slug: restaurant.slug, description: restaurant.description, address: restaurant.address, city: restaurant.city?.name, rating: Number(restaurant.ratingAverage), ratingCount: restaurant.ratingCount, openingTime: restaurant.openingTime, closingTime: restaurant.closingTime, temporarilyClosed: restaurant.temporarilyClosed, openNow: isRestaurantOpen(restaurant), categories: restaurant.categories })) })
  } catch { return response.status(503).json({ error: 'RESTAURANT_SERVICE_UNAVAILABLE' }) }
})

app.patch('/api/admin/service-areas/:serviceAreaId', requireUser, requireAdmin, async (request, response) => {
  const result = z.object({ enabled: z.boolean() }).safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_SERVICE_AREA_UPDATE' })
  try {
    const area = await prisma.serviceArea.findUnique({ where: { id: request.params.serviceAreaId } })
    if (!area) return response.status(404).json({ error: 'SERVICE_AREA_NOT_FOUND' })
    if (!result.data.enabled && area.enabled && await prisma.serviceArea.count({ where: { enabled: true } }) <= 1) return response.status(409).json({ error: 'LAST_ACTIVE_SERVICE_AREA' })
    const updated = await prisma.$transaction(async (transaction) => {
      const changed = await transaction.serviceArea.update({ where: { id: area.id }, data: { enabled: result.data.enabled } })
      await transaction.auditLog.create({ data: { actorId: request.user.id, action: result.data.enabled ? 'ENABLE_SERVICE_AREA' : 'DISABLE_SERVICE_AREA', entityType: 'ServiceArea', entityId: area.id, metadata: { cityId: area.cityId } } })
      return changed
    })
    return response.json({ serviceArea: updated })
  } catch { return response.status(503).json({ error: 'SERVICE_AREA_SERVICE_UNAVAILABLE' }) }
})

app.get('/api/payments/config', (_request, response) => {
  const provider = process.env.PAYMENT_PROVIDER || process.env.PAYMENTS_PROVIDER || 'paystack'
  response.json({ provider, configured: Boolean(process.env.PAYSTACK_SECRET_KEY), publicKey: process.env.PAYSTACK_PUBLIC_KEY || null })
})

app.get('/api/restaurants/:restaurantId/reviews', async (request, response) => {
  const result = z.object({ limit: z.coerce.number().int().min(1).max(20).default(6) }).safeParse(request.query)
  if (!result.success) return response.status(400).json({ error: 'INVALID_REVIEW_PAGINATION' })
  try {
    const restaurant = await prisma.restaurant.findFirst({ where: { id: request.params.restaurantId, status: 'APPROVED' }, select: { id: true, ratingAverage: true, ratingCount: true } })
    if (!restaurant) return response.status(404).json({ error: 'RESTAURANT_NOT_FOUND' })
    const reviews = await prisma.review.findMany({ where: { restaurantId: restaurant.id, moderatedAt: { not: null } }, select: { id: true, rating: true, body: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: result.data.limit })
    return response.json({ restaurant, reviews })
  } catch { return response.status(503).json({ error: 'REVIEW_SERVICE_UNAVAILABLE' }) }
})

app.post('/api/uploads/private-document', requireUser, upload.single('document'), async (request, response) => {
  if (!request.file) return response.status(400).json({ error: 'DOCUMENT_REQUIRED' })
  if (!['CUSTOMER', 'RESTAURANT', 'RIDER', 'ADMIN'].includes(request.user.role) || (request.user.role === 'CUSTOMER' && !request.file.mimetype.startsWith('image/'))) return response.status(403).json({ error: 'UPLOAD_FORBIDDEN' })
  try {
    const stored = await storePrivateDocument({ buffer: request.file.buffer, mimeType: request.file.mimetype, originalName: request.file.originalname, keyPrefix: request.user.role === 'CUSTOMER' ? `private/users/${request.user.id}` : 'private/documents' })
    return response.status(201).json({ storageKey: stored.storageKey, checksum: stored.checksum, mimeType: stored.mimeType, size: stored.size })
  } catch (error) {
    return response.status(error.status || 503).json({ error: error.code || 'UPLOAD_SERVICE_UNAVAILABLE', message: error.message })
  }
})

const credentialsSchema = z.object({ email: z.string().email().transform((value) => value.toLowerCase()), password: z.string().min(8), firstName: z.string().min(1).max(80).optional(), lastName: z.string().min(1).max(80).optional(), phone: z.string().min(7).max(30).optional() })
const orderSchema = z.object({ restaurantId: z.string().min(1), items: z.array(z.object({ menuItemId: z.string().min(1), quantity: z.number().int().positive().max(50), instructions: z.string().max(500).optional() })).min(1), addressId: z.string().min(1).optional(), addressLine: z.string().min(5).max(240).optional(), phone: z.string().min(7).max(30).optional(), landmark: z.string().max(200).optional() })
const privateDocumentSchema = z.object({ type: z.string().min(2).max(80), storageKey: z.string().startsWith('private/applications/').max(500) })
const partnerApplicationSchema = z.object({ restaurantName: z.string().min(2).max(120), businessType: z.string().min(2).max(60), registrationNumber: z.string().min(2).max(100), businessPhone: z.string().min(7).max(30), businessEmail: z.string().email(), address: z.string().min(5).max(240), cityName: z.string().default('Sapele'), ownerName: z.string().min(2).max(120), ownerIdentityType: z.string().min(2).max(60), ownerIdentityNumber: z.string().min(3).max(120), password: z.string().min(8), documents: z.array(privateDocumentSchema).min(2).max(5) })
const riderApplicationSchema = z.object({ firstName: z.string().min(1).max(80), lastName: z.string().min(1).max(80), email: z.string().email(), phone: z.string().min(7).max(30), address: z.string().min(5).max(240), identityType: z.string().min(2).max(60), identityNumber: z.string().min(3).max(120), vehicleType: z.string().min(2).max(50), vehicleRegistration: z.string().min(2).max(100), emergencyName: z.string().min(2).max(120), emergencyPhone: z.string().min(7).max(30), password: z.string().min(8), documents: z.array(privateDocumentSchema).min(2).max(5) })
const verificationRequestSchema = z.object({ destination: z.string().min(6), channel: z.enum(['email', 'phone']) })
const verificationSchema = z.object({ challengeId: z.string().min(1), destination: z.string().min(6), code: z.string().regex(/^\d{6}$/) })

async function storeApplicationDocuments(files) {
  if (!files || files.length < 2 || files.length > 5) throw Object.assign(new Error('At least two verification documents are required.'), { code: 'APPLICATION_DOCUMENTS_REQUIRED', status: 400 })
  return Promise.all(files.map((file, index) => storePrivateDocument({ buffer: file.buffer, mimeType: file.mimetype, originalName: file.originalname, keyPrefix: 'private/applications' }).then((stored) => ({ type: index === 0 ? 'IDENTITY' : 'BUSINESS_OR_VEHICLE', storageKey: stored.storageKey }))))
}

app.post('/api/auth/verification/request', authFlowLimiter, async (request, response) => {
  const result = verificationRequestSchema.safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_VERIFICATION_REQUEST' })
  try { return response.status(201).json(await issueVerificationCode(result.data)) } catch { return response.status(503).json({ error: 'VERIFICATION_SERVICE_UNAVAILABLE' }) }
})
app.post('/api/auth/verification/verify', authFlowLimiter, async (request, response) => {
  const result = verificationSchema.safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_VERIFICATION_CODE' })
  try { return response.json({ verified: await verifyCode(result.data) }) } catch { return response.status(503).json({ error: 'VERIFICATION_SERVICE_UNAVAILABLE' }) }
})

app.post('/api/auth/forgot-password', authFlowLimiter, async (request, response) => {
  const result = z.object({ email: z.string().email() }).safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_EMAIL' })
  try {
    const user = await prisma.user.findUnique({ where: { email: result.data.email.toLowerCase() } })
    if (!user) return response.json({ sent: true })
    return response.status(201).json({ sent: true, ...(await issueVerificationCode({ destination: user.email, channel: 'password_reset' })) })
  } catch { return response.status(503).json({ error: 'PASSWORD_RESET_UNAVAILABLE' }) }
})
app.post('/api/auth/reset-password', authFlowLimiter, async (request, response) => {
  const result = z.object({ email: z.string().email(), challengeId: z.string().min(1), code: z.string().regex(/^\d{6}$/), password: z.string().min(8) }).safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_PASSWORD_RESET' })
  try {
    if (!(await verifyCode({ challengeId: result.data.challengeId, destination: result.data.email, code: result.data.code }))) return response.status(400).json({ error: 'INVALID_OR_EXPIRED_CODE' })
    const user = await prisma.user.update({ where: { email: result.data.email.toLowerCase() }, data: { passwordHash: await hashPassword(result.data.password) } })
    await revokeUserSessions(user.id)
    return response.json({ reset: true })
  } catch { return response.status(503).json({ error: 'PASSWORD_RESET_UNAVAILABLE' }) }
})

app.post('/api/partner-applications', async (request, response) => {
  const result = partnerApplicationSchema.safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_PARTNER_APPLICATION', details: result.error.flatten() })
  try {
    const data = result.data
    const city = await prisma.city.findFirst({ where: { name: data.cityName } })
    if (!city) return response.status(400).json({ error: 'CITY_NOT_SUPPORTED' })
    const slug = `${data.restaurantName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${randomUUID().slice(0, 6)}`
    const created = await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({ data: { email: data.businessEmail, phone: data.businessPhone, passwordHash: await hashPassword(data.password), firstName: data.ownerName.split(' ')[0], lastName: data.ownerName.split(' ').slice(1).join(' ') || data.ownerName, role: 'RESTAURANT' } })
      const restaurant = await transaction.restaurant.create({ data: { name: data.restaurantName, slug, address: data.address, email: data.businessEmail, phone: data.businessPhone, cityId: city.id, application: { create: { ownerName: data.ownerName, ownerPhone: data.businessPhone, ownerEmail: data.businessEmail, identityType: data.ownerIdentityType, identityNumber: data.ownerIdentityNumber, documents: { create: data.documents.map((document) => ({ type: document.type, storageKey: document.storageKey })) } } } } })
      await transaction.restaurantUser.create({ data: { userId: user.id, restaurantId: restaurant.id } })
      return { restaurantId: restaurant.id, status: 'PENDING_APPROVAL' }
    })
    return response.status(201).json(created)
  } catch (error) {
    if (error.code === 'P2002') return response.status(409).json({ error: 'PARTNER_ACCOUNT_ALREADY_EXISTS' })
    return response.status(503).json({ error: 'PARTNER_APPLICATION_UNAVAILABLE' })
  }
})

app.post('/api/partner-applications/multipart', onboardingLimiter, upload.array('documents', 5), async (request, response) => {
  try {
    const fields = partnerApplicationSchema.omit({ documents: true }).safeParse(request.body)
    if (!fields.success) return response.status(400).json({ error: 'INVALID_PARTNER_APPLICATION', details: fields.error.flatten() })
    const documents = await storeApplicationDocuments(request.files)
    const data = { ...fields.data, documents }
    const city = await prisma.city.findFirst({ where: { name: data.cityName } })
    if (!city) return response.status(400).json({ error: 'CITY_NOT_SUPPORTED' })
    const slug = `${data.restaurantName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${randomUUID().slice(0, 6)}`
    const created = await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({ data: { email: data.businessEmail, phone: data.businessPhone, passwordHash: await hashPassword(data.password), firstName: data.ownerName.split(' ')[0], lastName: data.ownerName.split(' ').slice(1).join(' ') || data.ownerName, role: 'RESTAURANT' } })
      const restaurant = await transaction.restaurant.create({ data: { name: data.restaurantName, slug, address: data.address, email: data.businessEmail, phone: data.businessPhone, cityId: city.id, application: { create: { ownerName: data.ownerName, ownerPhone: data.businessPhone, ownerEmail: data.businessEmail, identityType: data.ownerIdentityType, identityNumber: data.ownerIdentityNumber, documents: { create: data.documents.map((document) => ({ type: document.type, storageKey: document.storageKey })) } } } } })
      await transaction.restaurantUser.create({ data: { userId: user.id, restaurantId: restaurant.id } })
      return { restaurantId: restaurant.id, status: 'PENDING_APPROVAL' }
    })
    return response.status(201).json(created)
  } catch (error) {
    if (error.code === 'P2002') return response.status(409).json({ error: 'PARTNER_ACCOUNT_ALREADY_EXISTS' })
    return response.status(error.status || 503).json({ error: error.code || 'PARTNER_APPLICATION_UNAVAILABLE' })
  }
})

app.post('/api/rider-applications', async (request, response) => {
  const result = riderApplicationSchema.safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_RIDER_APPLICATION', details: result.error.flatten() })
  try {
    const data = result.data
    const created = await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({ data: { email: data.email, phone: data.phone, passwordHash: await hashPassword(data.password), firstName: data.firstName, lastName: data.lastName, role: 'RIDER' } })
      const rider = await transaction.rider.create({ data: { userId: user.id, vehicleType: data.vehicleType, vehicleDetails: data.vehicleRegistration, application: { create: { identityType: data.identityType, identityNumber: data.identityNumber, emergencyName: data.emergencyName, emergencyPhone: data.emergencyPhone, identityDocuments: { create: data.documents.map((document) => ({ type: document.type, storageKey: document.storageKey })) } } } } })
      return { riderId: rider.id, status: 'PENDING_APPROVAL' }
    })
    return response.status(201).json(created)
  } catch (error) {
    if (error.code === 'P2002') return response.status(409).json({ error: 'RIDER_ACCOUNT_ALREADY_EXISTS' })
    return response.status(503).json({ error: 'RIDER_APPLICATION_UNAVAILABLE' })
  }
})

app.post('/api/rider-applications/multipart', onboardingLimiter, upload.array('documents', 5), async (request, response) => {
  try {
    const fields = riderApplicationSchema.omit({ documents: true }).safeParse(request.body)
    if (!fields.success) return response.status(400).json({ error: 'INVALID_RIDER_APPLICATION', details: fields.error.flatten() })
    const documents = await storeApplicationDocuments(request.files)
    const data = { ...fields.data, documents }
    const created = await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({ data: { email: data.email, phone: data.phone, passwordHash: await hashPassword(data.password), firstName: data.firstName, lastName: data.lastName, role: 'RIDER' } })
      const rider = await transaction.rider.create({ data: { userId: user.id, vehicleType: data.vehicleType, vehicleDetails: data.vehicleRegistration, application: { create: { identityType: data.identityType, identityNumber: data.identityNumber, emergencyName: data.emergencyName, emergencyPhone: data.emergencyPhone, identityDocuments: { create: data.documents.map((document) => ({ type: document.type, storageKey: document.storageKey })) } } } } })
      return { riderId: rider.id, status: 'PENDING_APPROVAL' }
    })
    return response.status(201).json(created)
  } catch (error) {
    if (error.code === 'P2002') return response.status(409).json({ error: 'RIDER_ACCOUNT_ALREADY_EXISTS' })
    return response.status(error.status || 503).json({ error: error.code || 'RIDER_APPLICATION_UNAVAILABLE' })
  }
})

app.post('/api/auth/register', async (request, response) => {
  const result = credentialsSchema.extend({ verificationId: z.string().min(1) }).safeParse(request.body)
  if (!result.success || !result.data.firstName || !result.data.lastName) return response.status(400).json({ error: 'INVALID_REGISTRATION', details: result.success ? 'First and last name are required.' : result.error.flatten() })
  try {
    const verification = await prisma.verificationCode.findFirst({ where: { id: result.data.verificationId, verifiedAt: { not: null }, expiresAt: { gt: new Date() } } })
    if (!verification || (verification.destination !== result.data.email && verification.destination !== result.data.phone?.toLowerCase())) return response.status(400).json({ error: 'ACCOUNT_VERIFICATION_REQUIRED' })
    const user = await prisma.user.create({ data: { email: result.data.email, phone: result.data.phone, passwordHash: await hashPassword(result.data.password), firstName: result.data.firstName, lastName: result.data.lastName, emailVerifiedAt: verification.channel === 'email' ? new Date() : null, phoneVerifiedAt: verification.channel === 'phone' ? new Date() : null, role: 'CUSTOMER', customer: { create: {} } } })
    const token = await createSession(user.id)
    return response.status(201).json({ token, user: publicUser(user) })
  } catch (error) {
    if (error.code === 'P2002') return response.status(409).json({ error: 'ACCOUNT_ALREADY_EXISTS' })
    return response.status(503).json({ error: 'AUTH_SERVICE_UNAVAILABLE' })
  }
})

app.post('/api/auth/login', async (request, response) => {
  const result = credentialsSchema.pick({ email: true, password: true }).safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_LOGIN', details: result.error.flatten() })
  try {
    const user = await prisma.user.findUnique({ where: { email: result.data.email } })
    if (!user || !(await verifyPassword(result.data.password, user.passwordHash)) || user.status !== 'ACTIVE') return response.status(401).json({ error: 'INVALID_CREDENTIALS' })
    const token = await createSession(user.id)
    return response.json({ token, user: publicUser(user) })
  } catch {
    return response.status(503).json({ error: 'AUTH_SERVICE_UNAVAILABLE' })
  }
})

app.get('/api/auth/me', requireUser, (request, response) => response.json({ user: publicUser(request.user) }))
app.patch('/api/auth/me', requireUser, async (request, response) => {
  const result = z.object({ firstName: z.string().min(1).max(80), lastName: z.string().min(1).max(80), preferredName: z.string().max(80).optional(), dateOfBirth: z.string().optional(), dietaryPreference: z.string().max(120).optional(), deliveryNotes: z.string().max(500).optional(), email: z.string().email().optional(), phone: z.string().min(7).max(30).optional() }).safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_PROFILE', details: result.error.flatten() })
  try {
    const { dateOfBirth, ...profileData } = result.data
    const user = await prisma.user.update({ where: { id: request.user.id }, data: { ...profileData, dateOfBirth: dateOfBirth ? new Date(`${dateOfBirth}T00:00:00.000Z`) : null } })
    return response.json({ user: publicUser(user) })
  } catch (error) {
    if (error.code === 'P2002') return response.status(409).json({ error: 'PHONE_ALREADY_IN_USE' })
    return response.status(503).json({ error: 'PROFILE_SERVICE_UNAVAILABLE' })
  }
})
app.post('/api/auth/logout', requireUser, async (request, response) => { await revokeSession(request.sessionId); response.status(204).end() })

app.get('/api/addresses', requireUser, async (request, response) => {
  try { return response.json({ addresses: await prisma.address.findMany({ where: { userId: request.user.id }, orderBy: { createdAt: 'desc' } }) }) } catch { return response.status(503).json({ error: 'ADDRESS_SERVICE_UNAVAILABLE' }) }
})
app.post('/api/addresses', requireUser, async (request, response) => {
  const result = z.object({ label: z.string().min(1).max(40), addressLine: z.string().min(5).max(240), landmark: z.string().max(200).optional(), latitude: z.number().gte(-90).lte(90).optional(), longitude: z.number().gte(-180).lte(180).optional(), cityId: z.string().min(1).optional() }).safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_ADDRESS', details: result.error.flatten() })
  try {
    const activeServiceArea = await prisma.serviceArea.findFirst({ where: { enabled: true }, orderBy: { createdAt: 'asc' } })
    if (!activeServiceArea) return response.status(503).json({ error: 'SERVICE_AREA_UNAVAILABLE' })
    if (result.data.cityId && !(await prisma.serviceArea.findFirst({ where: { cityId: result.data.cityId, enabled: true } }))) return response.status(400).json({ error: 'CITY_OUTSIDE_SERVICE_AREA' })
    return response.status(201).json({ address: await prisma.address.create({ data: { ...result.data, cityId: result.data.cityId || activeServiceArea.cityId, userId: request.user.id } }) })
  } catch { return response.status(503).json({ error: 'ADDRESS_SERVICE_UNAVAILABLE' }) }
})
app.patch('/api/addresses/:addressId', requireUser, async (request, response) => {
  const result = z.object({ label: z.string().min(1).max(40), addressLine: z.string().min(5).max(240), landmark: z.string().max(200).optional(), latitude: z.number().gte(-90).lte(90).optional(), longitude: z.number().gte(-180).lte(180).optional(), cityId: z.string().min(1).optional() }).safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_ADDRESS' })
  try {
    if (result.data.cityId && !(await prisma.serviceArea.findFirst({ where: { cityId: result.data.cityId, enabled: true } }))) return response.status(400).json({ error: 'CITY_OUTSIDE_SERVICE_AREA' })
    const address = await prisma.address.updateMany({ where: { id: request.params.addressId, userId: request.user.id }, data: result.data }); return response.json({ updated: address.count === 1 })
  } catch { return response.status(503).json({ error: 'ADDRESS_SERVICE_UNAVAILABLE' }) }
})
app.delete('/api/addresses/:addressId', requireUser, async (request, response) => { try { const result = await prisma.address.deleteMany({ where: { id: request.params.addressId, userId: request.user.id } }); return response.json({ deleted: result.count === 1 }) } catch { return response.status(503).json({ error: 'ADDRESS_SERVICE_UNAVAILABLE' }) } })

app.post('/api/profile/photo', requireUser, async (request, response) => {
  const result = z.object({ storageKey: z.string().startsWith('private/').max(500) }).safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_PROFILE_PHOTO' })
  if (!result.data.storageKey.startsWith(`private/users/${request.user.id}/`)) return response.status(403).json({ error: 'PROFILE_PHOTO_OWNERSHIP_REQUIRED' })
  try { const user = await prisma.user.update({ where: { id: request.user.id }, data: { profileImageKey: result.data.storageKey } }); return response.json({ user: publicUser(user) }) } catch { return response.status(503).json({ error: 'PROFILE_SERVICE_UNAVAILABLE' }) }
})

app.get('/api/favorites', requireUser, async (request, response) => { try { return response.json({ favorites: await prisma.favorite.findMany({ where: { userId: request.user.id }, include: { restaurant: true, menuItem: true } }) }) } catch { return response.status(503).json({ error: 'FAVORITES_SERVICE_UNAVAILABLE' }) } })
app.post('/api/favorites', requireUser, async (request, response) => {
  const result = z.object({ restaurantId: z.string().optional(), menuItemId: z.string().optional() }).refine((value) => value.restaurantId || value.menuItemId).safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'FAVORITE_TARGET_REQUIRED' })
  try { const favorite = await prisma.favorite.create({ data: { userId: request.user.id, ...result.data } }); return response.status(201).json({ favorite }) } catch (error) { if (error.code === 'P2002') return response.status(409).json({ error: 'ALREADY_FAVORITED' }); return response.status(503).json({ error: 'FAVORITES_SERVICE_UNAVAILABLE' }) }
})
app.delete('/api/favorites', requireUser, async (request, response) => { const result = z.object({ restaurantId: z.string().optional(), menuItemId: z.string().optional() }).safeParse(request.body); if (!result.success) return response.status(400).json({ error: 'FAVORITE_TARGET_REQUIRED' }); try { const deleted = await prisma.favorite.deleteMany({ where: { userId: request.user.id, ...result.data } }); return response.json({ deleted: deleted.count === 1 }) } catch { return response.status(503).json({ error: 'FAVORITES_SERVICE_UNAVAILABLE' }) } })

app.get('/api/notifications', requireUser, async (request, response) => {
  try {
    const result = z.object({ cursor: z.string().min(1).optional(), limit: z.coerce.number().int().min(1).max(50).default(50) }).safeParse(request.query)
    if (!result.success) return response.status(400).json({ error: 'INVALID_NOTIFICATION_PAGINATION' })
    const rows = await prisma.notification.findMany({ where: { userId: request.user.id }, orderBy: { createdAt: 'desc' }, take: result.data.limit + 1, ...(result.data.cursor ? { cursor: { id: result.data.cursor }, skip: 1 } : {}) })
    const hasNextPage = rows.length > result.data.limit
    if (hasNextPage) rows.pop()
    return response.json({ notifications: rows, nextCursor: hasNextPage ? rows.at(-1)?.id || null : null })
  } catch { return response.status(503).json({ error: 'NOTIFICATION_SERVICE_UNAVAILABLE' }) }
})
app.patch('/api/notifications/:notificationId/read', requireUser, async (request, response) => {
  try {
    const notification = await prisma.notification.updateMany({ where: { id: request.params.notificationId, userId: request.user.id }, data: { readAt: new Date() } })
    return response.json({ updated: notification.count === 1 })
  } catch { return response.status(503).json({ error: 'NOTIFICATION_SERVICE_UNAVAILABLE' }) }
})
app.post('/api/notifications/read-all', requireUser, async (request, response) => {
  try {
    const result = await prisma.notification.updateMany({ where: { userId: request.user.id, readAt: null }, data: { readAt: new Date() } })
    return response.json({ updated: result.count })
  } catch { return response.status(503).json({ error: 'NOTIFICATION_SERVICE_UNAVAILABLE' }) }
})

const supportSchema = z.object({ category: z.enum(['PAYMENT', 'MISSING_ORDER', 'WRONG_FOOD', 'LATE_DELIVERY', 'RESTAURANT', 'RIDER', 'ACCOUNT', 'REFUND', 'TECHNICAL']), description: z.string().min(10).max(4000), attachments: z.array(z.string().startsWith('private/')).max(3).optional() })
app.post('/api/support/tickets', requireUser, async (request, response) => {
  const result = supportSchema.safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_SUPPORT_TICKET', details: result.error.flatten() })
  if (request.user.role === 'CUSTOMER' && result.data.attachments?.some((key) => !key.startsWith(`private/users/${request.user.id}/`))) return response.status(403).json({ error: 'ATTACHMENT_OWNERSHIP_REQUIRED' })
  try {
    const ticket = await prisma.supportTicket.create({ data: { ticketNumber: `DSP-SUP-${Date.now().toString(36).toUpperCase()}`, userId: request.user.id, category: result.data.category, description: result.data.description, attachments: result.data.attachments || [], messages: { create: [{ senderId: request.user.id, senderType: 'CUSTOMER', body: result.data.description }, { senderType: 'AI', body: automatedSupportReply(result.data.category, result.data.description) }] } }, include: { messages: true } })
    return response.status(201).json({ ticket, aiReply: ticket.messages.at(-1) })
  } catch { return response.status(503).json({ error: 'SUPPORT_SERVICE_UNAVAILABLE' }) }
})
app.post('/api/support/ai', (request, response) => {
  const result = z.object({ message: z.string().min(1).max(4000), category: z.string().optional() }).safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'MESSAGE_REQUIRED' })
  return response.json({ reply: buildAiReply(result.data.message, result.data.category) })
})
app.get('/api/support/tickets', requireUser, async (request, response) => {
  try {
    const tickets = await prisma.supportTicket.findMany({ where: request.user.role === 'ADMIN' ? {} : { userId: request.user.id }, include: { messages: { orderBy: { createdAt: 'asc' } } }, orderBy: { createdAt: 'desc' } })
    return response.json({ tickets })
  } catch { return response.status(503).json({ error: 'SUPPORT_SERVICE_UNAVAILABLE' }) }
})
app.post('/api/support/tickets/:ticketId/messages', requireUser, async (request, response) => {
  const result = z.object({ body: z.string().min(1).max(4000) }).safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'MESSAGE_REQUIRED' })
  try {
    const ticket = await prisma.supportTicket.findUnique({ where: { id: request.params.ticketId } })
    if (!ticket || (request.user.role !== 'ADMIN' && ticket.userId !== request.user.id)) return response.status(404).json({ error: 'TICKET_NOT_FOUND' })
    const message = await prisma.supportMessage.create({ data: { ticketId: ticket.id, senderId: request.user.id, senderType: request.user.role === 'ADMIN' ? 'ADMIN' : 'CUSTOMER', body: result.data.body } })
    return response.status(201).json({ message })
  } catch { return response.status(503).json({ error: 'SUPPORT_SERVICE_UNAVAILABLE' }) }
})

app.get('/api/admin/applications/:type', requireUser, requireAdmin, async (request, response) => {
  if (!['restaurant', 'rider'].includes(request.params.type)) return response.status(400).json({ error: 'INVALID_APPLICATION_TYPE' })
  try {
    const applications = request.params.type === 'restaurant'
      ? await prisma.restaurantApplication.findMany({ where: { status: 'PENDING_APPROVAL' }, include: { restaurant: true, documents: { select: { id: true, type: true, verifiedAt: true } } }, orderBy: { submittedAt: 'asc' } })
      : await prisma.riderApplication.findMany({ where: { status: 'PENDING_APPROVAL' }, include: { rider: { include: { user: true } }, identityDocuments: { select: { id: true, type: true, verifiedAt: true } } }, orderBy: { submittedAt: 'asc' } })
    return response.json({ applications })
  } catch { return response.status(503).json({ error: 'APPLICATION_SERVICE_UNAVAILABLE' }) }
})

app.get('/api/admin/summary', requireUser, requireAdmin, async (_request, response) => {
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  try {
    const [customers, restaurants, riders, ordersToday, activeDeliveries, pendingRestaurants, pendingRiders, sales] = await Promise.all([
      prisma.user.count({ where: { role: 'CUSTOMER' } }),
      prisma.restaurant.count({ where: { status: 'APPROVED' } }),
      prisma.rider.count({ where: { status: 'APPROVED' } }),
      prisma.order.count({ where: { createdAt: { gte: startOfDay } } }),
      prisma.delivery.count({ where: { status: { in: ['AVAILABLE', 'REQUESTED', 'ACCEPTED', 'GOING_TO_RESTAURANT', 'ARRIVED_AT_RESTAURANT', 'PICKED_UP', 'GOING_TO_CUSTOMER'] } } }),
      prisma.restaurantApplication.count({ where: { status: 'PENDING_APPROVAL' } }),
      prisma.riderApplication.count({ where: { status: 'PENDING_APPROVAL' } }),
      prisma.order.aggregate({ where: { createdAt: { gte: startOfDay } }, _sum: { totalMinor: true } }),
    ])
    return response.json({ customers, restaurants, riders, ordersToday, activeDeliveries, pendingApprovals: pendingRestaurants + pendingRiders, grossSalesMinor: sales._sum.totalMinor || 0 })
  } catch { return response.status(503).json({ error: 'ADMIN_SUMMARY_SERVICE_UNAVAILABLE' }) }
})

app.get('/api/admin/orders', requireUser, requireAdmin, async (request, response) => {
  const result = z.object({ cursor: z.string().min(1).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), status: z.string().min(2).optional() }).safeParse(request.query)
  if (!result.success) return response.status(400).json({ error: 'INVALID_ADMIN_ORDER_QUERY' })
  try {
    const orders = await prisma.order.findMany({ where: result.data.status ? { status: result.data.status } : {}, include: { restaurant: { select: { name: true } }, customer: { select: { firstName: true, lastName: true } }, rider: { include: { user: { select: { firstName: true, lastName: true } } } }, payment: { select: { status: true } } }, orderBy: { createdAt: 'desc' }, take: result.data.limit + 1, ...(result.data.cursor ? { cursor: { id: result.data.cursor }, skip: 1 } : {}) })
    const hasNextPage = orders.length > result.data.limit
    if (hasNextPage) orders.pop()
    return response.json({ orders, nextCursor: hasNextPage ? orders.at(-1)?.id || null : null })
  } catch { return response.status(503).json({ error: 'ADMIN_ORDER_SERVICE_UNAVAILABLE' }) }
})

app.get('/api/admin/finance-summary', requireUser, requireAdmin, async (_request, response) => {
  try {
    const [gross, commission, restaurantPayouts, refunds, successfulPayments] = await Promise.all([
      prisma.order.aggregate({ where: { status: { notIn: ['CANCELLED', 'REFUNDED'] } }, _sum: { totalMinor: true } }),
      prisma.commission.aggregate({ _sum: { amountMinor: true } }),
      prisma.restaurantPayout.aggregate({ _sum: { amountMinor: true } }),
      prisma.payment.aggregate({ where: { status: 'REFUNDED' }, _sum: { amountMinor: true } }),
      prisma.payment.count({ where: { status: 'SUCCESSFUL' } }),
    ])
    return response.json({ grossMinor: gross._sum.totalMinor || 0, commissionMinor: commission._sum.amountMinor || 0, restaurantPayoutMinor: restaurantPayouts._sum.amountMinor || 0, refundMinor: refunds._sum.amountMinor || 0, successfulPayments })
  } catch { return response.status(503).json({ error: 'ADMIN_FINANCE_SERVICE_UNAVAILABLE' }) }
})

app.get('/api/admin/audit-logs', requireUser, requireAdmin, async (request, response) => {
  const result = z.object({ cursor: z.string().min(1).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).safeParse(request.query)
  if (!result.success) return response.status(400).json({ error: 'INVALID_AUDIT_LOG_QUERY' })
  try {
    const logs = await prisma.auditLog.findMany({ include: { actor: { select: { firstName: true, lastName: true, email: true } } }, orderBy: { createdAt: 'desc' }, take: result.data.limit + 1, ...(result.data.cursor ? { cursor: { id: result.data.cursor }, skip: 1 } : {}) })
    const hasNextPage = logs.length > result.data.limit
    if (hasNextPage) logs.pop()
    return response.json({ logs, nextCursor: hasNextPage ? logs.at(-1)?.id || null : null })
  } catch { return response.status(503).json({ error: 'AUDIT_LOG_SERVICE_UNAVAILABLE' }) }
})

app.get('/api/admin/customers', requireUser, requireAdmin, async (request, response) => {
  const result = z.object({ cursor: z.string().min(1).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional() }).safeParse(request.query)
  if (!result.success) return response.status(400).json({ error: 'INVALID_CUSTOMER_QUERY' })
  try {
    const customers = await prisma.user.findMany({ where: { role: 'CUSTOMER', ...(result.data.status ? { status: result.data.status } : {}) }, select: { id: true, email: true, phone: true, firstName: true, lastName: true, status: true, createdAt: true, _count: { select: { orders: true, supportTickets: true } } }, orderBy: { createdAt: 'desc' }, take: result.data.limit + 1, ...(result.data.cursor ? { cursor: { id: result.data.cursor }, skip: 1 } : {}) })
    const hasNextPage = customers.length > result.data.limit
    if (hasNextPage) customers.pop()
    return response.json({ customers, nextCursor: hasNextPage ? customers.at(-1)?.id || null : null })
  } catch { return response.status(503).json({ error: 'ADMIN_CUSTOMER_SERVICE_UNAVAILABLE' }) }
})

app.get('/api/admin/reviews', requireUser, requireAdmin, async (request, response) => {
  const result = z.object({ cursor: z.string().min(1).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), pending: z.coerce.boolean().default(true) }).safeParse(request.query)
  if (!result.success) return response.status(400).json({ error: 'INVALID_REVIEW_QUERY' })
  try {
    const reviews = await prisma.review.findMany({ where: result.data.pending ? { moderatedAt: null } : {}, include: { restaurant: { select: { name: true } }, user: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: 'desc' }, take: result.data.limit + 1, ...(result.data.cursor ? { cursor: { id: result.data.cursor }, skip: 1 } : {}) })
    const hasNextPage = reviews.length > result.data.limit
    if (hasNextPage) reviews.pop()
    return response.json({ reviews, nextCursor: hasNextPage ? reviews.at(-1)?.id || null : null })
  } catch { return response.status(503).json({ error: 'ADMIN_REVIEW_SERVICE_UNAVAILABLE' }) }
})

const editablePlatformSettings = ['restaurant_commission_percentage', 'service_fee_percentage', 'maximum_delivery_radius_km', 'rider_base_earning_minor']
app.get('/api/admin/settings', requireUser, requireAdmin, async (_request, response) => {
  try {
    const settings = await prisma.platformSetting.findMany({ where: { key: { in: editablePlatformSettings } }, orderBy: { key: 'asc' } })
    return response.json({ settings })
  } catch { return response.status(503).json({ error: 'ADMIN_SETTINGS_SERVICE_UNAVAILABLE' }) }
})

app.patch('/api/admin/settings', requireUser, requireAdmin, async (request, response) => {
  const result = z.object({ key: z.enum(editablePlatformSettings), value: z.number().finite().nonnegative() }).safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_PLATFORM_SETTING' })
  try {
    const setting = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.platformSetting.upsert({ where: { key: result.data.key }, update: { value: result.data.value }, create: { key: result.data.key, value: result.data.value } })
      await transaction.auditLog.create({ data: { actorId: request.user.id, action: 'UPDATE_PLATFORM_SETTING', entityType: 'PlatformSetting', entityId: updated.id, metadata: { key: result.data.key, value: result.data.value } } })
      return updated
    })
    return response.json({ setting })
  } catch { return response.status(503).json({ error: 'ADMIN_SETTINGS_SERVICE_UNAVAILABLE' }) }
})

app.patch('/api/admin/reviews/:reviewId/moderation', requireUser, requireAdmin, async (request, response) => {
  const result = z.object({ approved: z.boolean() }).safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_REVIEW_MODERATION' })
  try {
    const review = await prisma.review.findUnique({ where: { id: request.params.reviewId } })
    if (!review) return response.status(404).json({ error: 'REVIEW_NOT_FOUND' })
    const updated = await prisma.$transaction(async (transaction) => {
      const changed = await transaction.review.update({ where: { id: review.id }, data: { moderatedAt: result.data.approved ? new Date() : null } })
      await transaction.auditLog.create({ data: { actorId: request.user.id, action: result.data.approved ? 'APPROVE_REVIEW' : 'REJECT_REVIEW', entityType: 'Review', entityId: review.id, metadata: { restaurantId: review.restaurantId } } })
      return changed
    })
    return response.json({ review: updated })
  } catch { return response.status(503).json({ error: 'ADMIN_REVIEW_SERVICE_UNAVAILABLE' }) }
})

app.patch('/api/admin/customers/:customerId/status', requireUser, requireAdmin, async (request, response) => {
  const result = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']) }).safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_CUSTOMER_STATUS' })
  try {
    const customer = await prisma.user.findFirst({ where: { id: request.params.customerId, role: 'CUSTOMER' }, select: { id: true, status: true } })
    if (!customer) return response.status(404).json({ error: 'CUSTOMER_NOT_FOUND' })
    const updated = await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.update({ where: { id: customer.id }, data: { status: result.data.status } })
      await transaction.auditLog.create({ data: { actorId: request.user.id, action: `CUSTOMER_STATUS_${result.data.status}`, entityType: 'User', entityId: customer.id, metadata: { previousStatus: customer.status } } })
      if (result.data.status !== 'ACTIVE') await transaction.session.deleteMany({ where: { userId: customer.id } })
      return user
    })
    return response.json({ customer: { id: updated.id, status: updated.status } })
  } catch { return response.status(503).json({ error: 'ADMIN_CUSTOMER_SERVICE_UNAVAILABLE' }) }
})

app.post('/api/admin/applications/:type/:applicationId/review', requireUser, requireAdmin, async (request, response) => {
  const result = z.object({ status: z.enum(['APPROVED', 'REJECTED', 'SUSPENDED']), note: z.string().max(1000).optional() }).safeParse(request.body)
  if (!result.success || !['restaurant', 'rider'].includes(request.params.type)) return response.status(400).json({ error: 'INVALID_APPLICATION_REVIEW' })
  try {
    const application = await reviewApplication({ type: request.params.type, id: request.params.applicationId, status: result.data.status, note: result.data.note, actorId: request.user.id })
    return response.json({ application })
  } catch (error) { return response.status(error.status || 503).json({ error: error.code || 'APPLICATION_SERVICE_UNAVAILABLE', message: error.message }) }
})

app.post('/api/orders/validate', requireUser, async (request, response) => {
  const result = orderSchema.safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_ORDER_REQUEST', details: result.error.flatten() })
  if (request.user.role !== 'CUSTOMER') return response.status(403).json({ error: 'CUSTOMER_ROLE_REQUIRED' })
  try {
    const quote = await quoteOrder({ ...result.data, customerId: request.user.id })
    return response.json(quote)
  } catch (error) {
    return response.status(error.status || 503).json({ error: error.code || 'ORDER_SERVICE_UNAVAILABLE', message: error.message })
  }
})

app.get('/api/orders', requireUser, async (request, response) => {
  if (request.user.role !== 'CUSTOMER') return response.status(403).json({ error: 'CUSTOMER_ROLE_REQUIRED' })
  const result = z.object({ cursor: z.string().min(1).optional(), limit: z.coerce.number().int().min(1).max(50).default(50) }).safeParse(request.query)
  if (!result.success) return response.status(400).json({ error: 'INVALID_ORDER_PAGINATION' })
  try {
    const orders = await prisma.order.findMany({ where: { customerId: request.user.id }, include: { restaurant: { select: { name: true } }, items: true, payment: { select: { status: true } }, delivery: { select: { status: true } } }, orderBy: { createdAt: 'desc' }, take: result.data.limit + 1, ...(result.data.cursor ? { cursor: { id: result.data.cursor }, skip: 1 } : {}) })
    const hasNextPage = orders.length > result.data.limit
    if (hasNextPage) orders.pop()
    return response.json({ orders, nextCursor: hasNextPage ? orders.at(-1)?.id || null : null })
  } catch { return response.status(503).json({ error: 'ORDER_SERVICE_UNAVAILABLE' }) }
})

app.post('/api/orders', requireUser, async (request, response) => {
  const result = orderSchema.safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_ORDER_REQUEST', details: result.error.flatten() })
  if (request.user.role !== 'CUSTOMER') return response.status(403).json({ error: 'CUSTOMER_ROLE_REQUIRED' })
  const idempotencyKey = request.get('idempotency-key')
  if (idempotencyKey && (idempotencyKey.length < 16 || idempotencyKey.length > 120)) return response.status(400).json({ error: 'INVALID_IDEMPOTENCY_KEY' })
  try {
    if (idempotencyKey) {
      const existing = await prisma.order.findUnique({ where: { idempotencyKey }, include: { items: true, payment: true, restaurant: true } })
      if (existing) return existing.customerId === request.user.id ? response.status(200).json({ order: existing, duplicate: true }) : response.status(409).json({ error: 'IDEMPOTENCY_KEY_CONFLICT' })
    }
    const quote = await quoteOrder({ ...result.data, customerId: request.user.id })
    const order = await prisma.$transaction(async (transaction) => {
      const orderNumber = `DSP-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomUUID().slice(0, 6).toUpperCase()}`
      const address = quote.address || await transaction.address.create({ data: { userId: request.user.id, cityId: quote.serviceAreaCityId, label: 'Checkout address', addressLine: result.data.addressLine, landmark: result.data.landmark } })
      const created = await transaction.order.create({ data: { orderNumber, idempotencyKey, customerId: request.user.id, restaurantId: quote.restaurantId, addressSnapshot: address.addressLine, landmarkSnapshot: result.data.landmark || address.landmark, subtotalMinor: quote.subtotalMinor, deliveryFeeMinor: quote.deliveryFeeMinor, serviceFeeMinor: quote.serviceFeeMinor, totalMinor: quote.totalMinor, items: { create: quote.items.map((item) => ({ menuItemId: item.menuItemId, nameSnapshot: item.name, unitPriceMinor: item.unitPriceMinor, quantity: item.quantity, instructions: item.instructions })) }, payment: { create: { provider: process.env.PAYMENT_PROVIDER || process.env.PAYMENTS_PROVIDER || 'paystack', reference: `pending_${randomUUID()}`, amountMinor: quote.totalMinor } } }, include: { items: true, payment: true } })
      return created
    })
    return response.status(201).json({ order })
  } catch (error) {
    return response.status(error.status || 503).json({ error: error.code || 'ORDER_SERVICE_UNAVAILABLE', message: error.message })
  }
})

app.post('/api/reviews', requireUser, async (request, response) => {
  if (request.user.role !== 'CUSTOMER') return response.status(403).json({ error: 'CUSTOMER_ROLE_REQUIRED' })
  const result = z.object({ orderId: z.string().min(1), rating: z.number().int().min(1).max(5), body: z.string().max(2000).optional() }).safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_REVIEW', details: result.error.flatten() })
  try {
    const order = await prisma.order.findFirst({ where: { id: result.data.orderId, customerId: request.user.id, status: 'DELIVERED' }, select: { id: true, restaurantId: true } })
    if (!order) return response.status(409).json({ error: 'ORDER_NOT_REVIEWABLE' })
    const review = await prisma.$transaction(async (transaction) => {
      const created = await transaction.review.create({ data: { userId: request.user.id, restaurantId: order.restaurantId, orderId: order.id, rating: result.data.rating, body: result.data.body } })
      const aggregate = await transaction.review.aggregate({ where: { restaurantId: order.restaurantId }, _avg: { rating: true }, _count: { _all: true } })
      await transaction.restaurant.update({ where: { id: order.restaurantId }, data: { ratingAverage: aggregate._avg.rating || 0, ratingCount: aggregate._count._all } })
      return created
    })
    return response.status(201).json({ review })
  } catch (error) {
    if (error.code === 'P2002') return response.status(409).json({ error: 'ORDER_ALREADY_REVIEWED' })
    return response.status(503).json({ error: 'REVIEW_SERVICE_UNAVAILABLE' })
  }
})

app.post('/api/payments/initialize', requireUser, async (request, response) => {
  const result = z.object({ orderId: z.string().min(1) }).safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_PAYMENT_REQUEST' })
  try {
    const order = await prisma.order.findFirst({ where: { id: result.data.orderId, customerId: request.user.id }, include: { payment: true } })
    if (!order || !order.payment) return response.status(404).json({ error: 'ORDER_PAYMENT_NOT_FOUND' })
    if (order.payment.status !== 'PENDING') return response.status(409).json({ error: 'PAYMENT_NOT_PENDING' })
    const payment = await initializePayment({ email: request.user.email, amountMinor: order.totalMinor, reference: order.payment.reference, callbackUrl: process.env.PAYMENT_CALLBACK_URL, metadata: { orderId: order.id, orderNumber: order.orderNumber } })
    return response.json(payment)
  } catch (error) {
    const paymentError = error instanceof PaymentError ? error : new PaymentError('PAYMENT_SERVICE_UNAVAILABLE', 'Payment service is unavailable.', 503)
    return response.status(paymentError.status).json({ error: paymentError.code, message: paymentError.message })
  }
})

app.post('/api/payments/webhook', async (request, response) => {
  if (!verifyWebhookSignature(request.rawBody, request.get('x-paystack-signature'))) return response.status(401).json({ error: 'INVALID_WEBHOOK_SIGNATURE' })
  const event = request.body
  if (event.event !== 'charge.success' || !event.data?.reference) return response.status(200).json({ received: true })
  try {
    const payment = await prisma.payment.findUnique({ where: { reference: event.data.reference } })
    if (!payment) return response.status(200).json({ received: true })
    if (payment.status === 'SUCCESSFUL') return response.status(200).json({ received: true, duplicate: true })
    if (!matchesPaystackPayment(payment, event)) return response.status(400).json({ error: 'PAYMENT_RECONCILIATION_FAILED' })
    await prisma.$transaction(async (transaction) => {
      const currentOrder = await transaction.order.findUnique({ where: { id: payment.orderId }, select: { status: true } })
      if (!currentOrder || !isOrderPayable(currentOrder.status)) throw Object.assign(new Error('Order is not payable in its current state.'), { code: 'ORDER_NOT_PAYABLE', status: 409 })
      await transaction.payment.update({ where: { id: payment.id }, data: { status: 'SUCCESSFUL', verifiedAt: new Date() } })
      const order = await transaction.order.update({ where: { id: payment.orderId }, data: { status: 'PAID', paidAt: new Date() }, include: { restaurant: { include: { users: true } } } })
      await transaction.delivery.upsert({ where: { orderId: payment.orderId }, update: {}, create: { orderId: payment.orderId, status: 'AVAILABLE', requestedAt: new Date() } })
      const commissionMinor = Math.round(order.subtotalMinor * 0.15)
      await transaction.commission.upsert({ where: { orderId: order.id }, update: {}, create: { orderId: order.id, percentage: 15, amountMinor: commissionMinor } })
      await transaction.restaurantPayout.upsert({ where: { orderId: order.id }, update: {}, create: { restaurantId: order.restaurantId, orderId: order.id, amountMinor: order.subtotalMinor - commissionMinor } })
      await transaction.notification.create({ data: { userId: order.customerId, type: 'PAYMENT', title: 'Payment confirmed', body: `Your payment for ${order.orderNumber} was confirmed. The restaurant is preparing your order.` } })
      for (const member of order.restaurant.users) await transaction.notification.create({ data: { userId: member.userId, type: 'ORDER', title: 'New paid order', body: `Order ${order.orderNumber} is ready for your restaurant to accept.` } })
      await transaction.transaction.create({ data: { paymentId: payment.id, type: 'PAYMENT_SUCCESS', amountMinor: payment.amountMinor, providerReference: event.data.reference, metadata: event.data } })
    })
    return response.status(200).json({ received: true })
  } catch {
    return response.status(503).json({ error: 'PAYMENT_WEBHOOK_RETRY' })
  }
})

app.get('/api/restaurant/orders', requireUser, async (request, response) => {
  if (request.user.role !== 'RESTAURANT') return response.status(403).json({ error: 'RESTAURANT_ROLE_REQUIRED' })
  const result = z.object({ cursor: z.string().min(1).optional(), limit: z.coerce.number().int().min(1).max(100).default(100) }).safeParse(request.query)
  if (!result.success) return response.status(400).json({ error: 'INVALID_ORDER_PAGINATION' })
  try {
    const membership = await prisma.restaurantUser.findFirst({ where: { userId: request.user.id }, select: { restaurantId: true } })
    if (!membership) return response.status(403).json({ error: 'RESTAURANT_ACCESS_REQUIRED' })
    const orders = await prisma.order.findMany({ where: { restaurantId: membership.restaurantId }, include: { items: true, customer: { select: { firstName: true, lastName: true, phone: true } }, delivery: true, payment: { select: { status: true } } }, orderBy: { createdAt: 'desc' }, take: result.data.limit + 1, ...(result.data.cursor ? { cursor: { id: result.data.cursor }, skip: 1 } : {}) })
    const hasNextPage = orders.length > result.data.limit
    if (hasNextPage) orders.pop()
    return response.json({ orders, nextCursor: hasNextPage ? orders.at(-1)?.id || null : null })
  } catch { return response.status(503).json({ error: 'RESTAURANT_ORDER_SERVICE_UNAVAILABLE' }) }
})

app.get('/api/restaurant/profile', requireUser, async (request, response) => {
  if (request.user.role !== 'RESTAURANT') return response.status(403).json({ error: 'RESTAURANT_ROLE_REQUIRED' })
  const membership = await prisma.restaurantUser.findFirst({ where: { userId: request.user.id }, include: { restaurant: true } })
  if (!membership) return response.status(403).json({ error: 'RESTAURANT_ACCESS_REQUIRED' })
  return response.json({ restaurant: membership.restaurant })
})

app.patch('/api/restaurant/profile', requireUser, async (request, response) => {
  if (request.user.role !== 'RESTAURANT') return response.status(403).json({ error: 'RESTAURANT_ROLE_REQUIRED' })
  const result = z.object({ name: z.string().min(2).max(120), description: z.string().max(500).optional(), phone: z.string().max(30).optional(), address: z.string().min(5).max(240) }).safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_RESTAURANT_PROFILE' })
  const membership = await prisma.restaurantUser.findFirst({ where: { userId: request.user.id }, select: { restaurantId: true } })
  if (!membership) return response.status(403).json({ error: 'RESTAURANT_ACCESS_REQUIRED' })
  try { return response.json({ restaurant: await prisma.restaurant.update({ where: { id: membership.restaurantId }, data: result.data }) }) } catch { return response.status(503).json({ error: 'RESTAURANT_PROFILE_SERVICE_UNAVAILABLE' }) }
})

app.get('/api/restaurant/menu', requireUser, async (request, response) => {
  if (request.user.role !== 'RESTAURANT') return response.status(403).json({ error: 'RESTAURANT_ROLE_REQUIRED' })
  const membership = await prisma.restaurantUser.findFirst({ where: { userId: request.user.id }, select: { restaurantId: true } })
  if (!membership) return response.status(403).json({ error: 'RESTAURANT_ACCESS_REQUIRED' })
  try { return response.json({ items: await prisma.menuItem.findMany({ where: { restaurantId: membership.restaurantId }, orderBy: { name: 'asc' } }) }) } catch { return response.status(503).json({ error: 'RESTAURANT_MENU_SERVICE_UNAVAILABLE' }) }
})

app.post('/api/restaurant/menu', requireUser, async (request, response) => {
  if (request.user.role !== 'RESTAURANT') return response.status(403).json({ error: 'RESTAURANT_ROLE_REQUIRED' })
  const result = z.object({ name: z.string().min(2).max(120), description: z.string().max(500).optional(), priceMinor: z.number().int().positive(), imageUrl: z.string().url().optional(), prepMinutes: z.number().int().positive().max(240).optional() }).safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_MENU_ITEM' })
  const membership = await prisma.restaurantUser.findFirst({ where: { userId: request.user.id }, select: { restaurantId: true } })
  if (!membership) return response.status(403).json({ error: 'RESTAURANT_ACCESS_REQUIRED' })
  try { return response.status(201).json({ item: await prisma.menuItem.create({ data: { ...result.data, restaurantId: membership.restaurantId } }) }) } catch { return response.status(503).json({ error: 'RESTAURANT_MENU_SERVICE_UNAVAILABLE' }) }
})

app.patch('/api/restaurant/menu/:itemId', requireUser, async (request, response) => {
  if (request.user.role !== 'RESTAURANT') return response.status(403).json({ error: 'RESTAURANT_ROLE_REQUIRED' })
  const result = z.object({ name: z.string().min(2).max(120), description: z.string().max(500).optional(), priceMinor: z.number().int().positive(), available: z.boolean().optional() }).safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_MENU_ITEM' })
  const membership = await prisma.restaurantUser.findFirst({ where: { userId: request.user.id }, select: { restaurantId: true } })
  if (!membership) return response.status(403).json({ error: 'RESTAURANT_ACCESS_REQUIRED' })
  try { const updated = await prisma.menuItem.updateMany({ where: { id: request.params.itemId, restaurantId: membership.restaurantId }, data: result.data }); return response.json({ updated: updated.count === 1 }) } catch { return response.status(503).json({ error: 'RESTAURANT_MENU_SERVICE_UNAVAILABLE' }) }
})

app.get('/api/restaurant/summary', requireUser, async (request, response) => {
  if (request.user.role !== 'RESTAURANT') return response.status(403).json({ error: 'RESTAURANT_ROLE_REQUIRED' })
  const membership = await prisma.restaurantUser.findFirst({ where: { userId: request.user.id }, select: { restaurantId: true } })
  if (!membership) return response.status(403).json({ error: 'RESTAURANT_ACCESS_REQUIRED' })
  try { const [orders, payout] = await Promise.all([prisma.order.findMany({ where: { restaurantId: membership.restaurantId }, include: { items: true, customer: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: 'desc' }, take: 50 }), prisma.restaurantPayout.aggregate({ where: { restaurantId: membership.restaurantId }, _sum: { amountMinor: true } })]); return response.json({ orders, grossMinor: orders.reduce((sum, order) => sum + order.totalMinor, 0), payoutMinor: payout._sum.amountMinor || 0 }) } catch { return response.status(503).json({ error: 'RESTAURANT_SUMMARY_SERVICE_UNAVAILABLE' }) }
})

app.get('/api/rider/deliveries', requireUser, async (request, response) => {
  if (request.user.role !== 'RIDER' || !request.user.rider) return response.status(403).json({ error: 'RIDER_ROLE_REQUIRED' })
  try {
    const deliveries = await prisma.delivery.findMany({ where: { OR: [{ status: 'AVAILABLE' }, { riderId: request.user.rider.id, status: { notIn: ['DELIVERED', 'CANCELLED'] } }] }, include: { order: { include: { restaurant: { select: { name: true, address: true, phone: true } } } } }, orderBy: { requestedAt: 'asc' }, take: 50 })
    return response.json({ deliveries })
  } catch { return response.status(503).json({ error: 'RIDER_DELIVERY_SERVICE_UNAVAILABLE' }) }
})

app.patch('/api/rider/availability', requireUser, async (request, response) => {
  const result = z.object({ availability: z.enum(['ONLINE', 'OFFLINE']) }).safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_AVAILABILITY' })
  if (request.user.role !== 'RIDER' || !request.user.rider) return response.status(403).json({ error: 'RIDER_ROLE_REQUIRED' })
  try {
    if (request.user.rider.status !== 'APPROVED' && result.data.availability === 'ONLINE') return response.status(403).json({ error: 'RIDER_NOT_APPROVED' })
    const rider = await prisma.rider.update({ where: { id: request.user.rider.id }, data: { availability: result.data.availability } })
    return response.json({ rider: { id: rider.id, availability: rider.availability, status: rider.status } })
  } catch { return response.status(503).json({ error: 'RIDER_AVAILABILITY_SERVICE_UNAVAILABLE' }) }
})

app.get('/api/rider/history', requireUser, async (request, response) => {
  if (request.user.role !== 'RIDER' || !request.user.rider) return response.status(403).json({ error: 'RIDER_ROLE_REQUIRED' })
  try { const orders = await prisma.order.findMany({ where: { riderId: request.user.rider.id }, include: { restaurant: { select: { name: true } }, riderPayout: true }, orderBy: { createdAt: 'desc' }, take: 100 }); return response.json({ orders }) } catch { return response.status(503).json({ error: 'RIDER_HISTORY_SERVICE_UNAVAILABLE' }) }
})

app.get('/api/rider/earnings', requireUser, async (request, response) => {
  if (request.user.role !== 'RIDER' || !request.user.rider) return response.status(403).json({ error: 'RIDER_ROLE_REQUIRED' })
  try { const payouts = await prisma.riderPayout.findMany({ where: { riderId: request.user.rider.id }, include: { order: { select: { orderNumber: true, createdAt: true } } }, orderBy: { order: { createdAt: 'desc' } }, take: 100 }); return response.json({ payouts, totalMinor: payouts.reduce((sum, payout) => sum + payout.amountMinor, 0) }) } catch { return response.status(503).json({ error: 'RIDER_EARNINGS_SERVICE_UNAVAILABLE' }) }
})

app.post('/api/deliveries/:deliveryId/claim', requireUser, async (request, response) => {
  if (request.user.role !== 'RIDER' || !request.user.rider) return response.status(403).json({ error: 'RIDER_ROLE_REQUIRED' })
  try {
    const delivery = await claimDelivery(request.params.deliveryId, request.user.rider.id)
    return response.json({ delivery })
  } catch (error) {
    return response.status(error.status || 503).json({ error: error.code || 'DELIVERY_SERVICE_UNAVAILABLE', message: error.message })
  }
})

app.post('/api/deliveries/:deliveryId/status', requireUser, async (request, response) => {
  const result = z.object({ status: z.enum(['GOING_TO_RESTAURANT', 'ARRIVED_AT_RESTAURANT', 'PICKED_UP', 'GOING_TO_CUSTOMER', 'DELIVERED']) }).safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_DELIVERY_STATUS' })
  if (request.user.role !== 'RIDER' || !request.user.rider) return response.status(403).json({ error: 'RIDER_ROLE_REQUIRED' })
  try {
    const delivery = await advanceDelivery(request.params.deliveryId, request.user.rider.id, result.data.status)
    return response.json({ delivery })
  } catch (error) {
    return response.status(error.status || 503).json({ error: error.code || 'DELIVERY_SERVICE_UNAVAILABLE', message: error.message })
  }
})

app.post('/api/deliveries/by-order/:orderNumber/status', requireUser, async (request, response) => {
  const result = z.object({ status: z.enum(['GOING_TO_RESTAURANT', 'ARRIVED_AT_RESTAURANT', 'PICKED_UP', 'GOING_TO_CUSTOMER', 'DELIVERED']) }).safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_DELIVERY_STATUS' })
  if (request.user.role !== 'RIDER' || !request.user.rider) return response.status(403).json({ error: 'RIDER_ROLE_REQUIRED' })
  try { const order = await prisma.order.findFirst({ where: { orderNumber: request.params.orderNumber, riderId: request.user.rider.id }, select: { delivery: { select: { id: true } } } }); if (!order?.delivery) return response.status(404).json({ error: 'DELIVERY_NOT_FOUND' }); const delivery = await advanceDelivery(order.delivery.id, request.user.rider.id, result.data.status); return response.json({ delivery }) } catch (error) { return response.status(error.status || 503).json({ error: error.code || 'DELIVERY_SERVICE_UNAVAILABLE', message: error.message }) }
})

app.post('/api/deliveries/:deliveryId/location', requireUser, async (request, response) => {
  const result = z.object({ latitude: z.number().gte(-90).lte(90), longitude: z.number().gte(-180).lte(180) }).safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_LOCATION' })
  if (request.user.role !== 'RIDER' || !request.user.rider) return response.status(403).json({ error: 'RIDER_ROLE_REQUIRED' })
  try {
    await recordLocation(request.params.deliveryId, request.user.rider.id, result.data.latitude, result.data.longitude)
    return response.status(202).json({ accepted: true })
  } catch (error) {
    return response.status(error.status || 503).json({ error: error.code || 'LOCATION_SERVICE_UNAVAILABLE', message: error.message })
  }
})

app.get('/api/orders/:orderId/tracking', requireUser, async (request, response) => {
  try {
    const order = await prisma.order.findUnique({ where: { id: request.params.orderId }, include: { restaurant: { include: { users: { select: { userId: true } } } }, delivery: { include: { rider: { include: { user: true } } } } } })
    if (!order) return response.status(404).json({ error: 'ORDER_NOT_FOUND' })
    if (request.user.role === 'CUSTOMER' && order.customerId !== request.user.id) return response.status(403).json({ error: 'ORDER_ACCESS_FORBIDDEN' })
    if (!['CUSTOMER', 'ADMIN', 'RESTAURANT'].includes(request.user.role)) return response.status(403).json({ error: 'ORDER_ACCESS_FORBIDDEN' })
    if (request.user.role === 'RESTAURANT' && !order.restaurant.users.some((member) => member.userId === request.user.id)) return response.status(403).json({ error: 'RESTAURANT_ACCESS_REQUIRED' })
    const location = order.delivery?.riderId ? await prisma.riderLocation.findFirst({ where: { riderId: order.delivery.riderId, deliveryId: order.delivery.id }, orderBy: { recordedAt: 'desc' } }) : null
    const activeDelivery = order.delivery && !['DELIVERED', 'CANCELLED'].includes(order.delivery.status)
    return response.json({ order: { id: order.id, orderNumber: order.orderNumber, restaurant: order.restaurant.name, status: order.status, delivery: order.delivery ? { status: order.delivery.status, location: location ? { latitude: location.latitude, longitude: location.longitude, recordedAt: location.recordedAt } : null, rider: activeDelivery && order.delivery.rider ? { name: `${order.delivery.rider.user.firstName} ${order.delivery.rider.user.lastName}`, phone: order.delivery.rider.user.phone, callAllowed: Boolean(order.delivery.rider.user.phone) } : null } : null } })
  } catch {
    return response.status(503).json({ error: 'TRACKING_SERVICE_UNAVAILABLE' })
  }
})

app.get('/api/orders/track', publicTrackingLimiter, async (request, response) => {
  const result = z.object({ orderNumber: z.string().min(6).max(80), phone: z.string().min(7).max(30) }).safeParse(request.query)
  if (!result.success) return response.status(400).json({ error: 'TRACKING_DETAILS_REQUIRED' })
  try {
    const order = await prisma.order.findFirst({ where: { orderNumber: result.data.orderNumber, customer: { phone: result.data.phone } }, include: { restaurant: { select: { name: true } }, delivery: { select: { status: true } } } })
    if (!order) return response.status(404).json({ error: 'ORDER_NOT_FOUND' })
    return response.json({ order: { orderNumber: order.orderNumber, restaurant: order.restaurant.name, status: order.status, delivery: order.delivery ? { status: order.delivery.status } : null, createdAt: order.createdAt } })
  } catch { return response.status(503).json({ error: 'TRACKING_SERVICE_UNAVAILABLE' }) }
})

const transitions = { CUSTOMER: {}, RESTAURANT: { PAID: 'RESTAURANT_ACCEPTED', RESTAURANT_ACCEPTED: 'PREPARING', PREPARING: 'READY_FOR_PICKUP' }, RIDER: { READY_FOR_PICKUP: 'RIDER_ASSIGNED', RIDER_ASSIGNED: 'PICKED_UP', PICKED_UP: 'OUT_FOR_DELIVERY', OUT_FOR_DELIVERY: 'DELIVERED' }, ADMIN: { PAID: 'CANCELLED', RESTAURANT_ACCEPTED: 'CANCELLED', PREPARING: 'CANCELLED', READY_FOR_PICKUP: 'CANCELLED', RIDER_ASSIGNED: 'CANCELLED', PICKED_UP: 'CANCELLED', OUT_FOR_DELIVERY: 'CANCELLED' } }
app.post('/api/orders/:orderId/status', requireUser, async (request, response) => {
  const result = z.object({ status: z.string() }).safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_STATUS_REQUEST' })
  try {
    const order = await prisma.order.findUnique({ where: { id: request.params.orderId }, include: { restaurant: { include: { users: true } }, delivery: true } })
    if (!order) return response.status(404).json({ error: 'ORDER_NOT_FOUND' })
    const expected = transitions[request.user.role]?.[order.status]
    if (expected !== result.data.status) return response.status(409).json({ error: 'INVALID_STATUS_TRANSITION', expected: expected || null })
    const isRestaurantOwner = request.user.role === 'RESTAURANT' && order.restaurant.users.some((member) => member.userId === request.user.id)
    const isRider = request.user.role === 'RIDER' && order.riderId === request.user.rider?.id
    if (request.user.role === 'RESTAURANT' && !isRestaurantOwner) return response.status(403).json({ error: 'RESTAURANT_ACCESS_REQUIRED' })
    if (request.user.role === 'RIDER' && !isRider) return response.status(403).json({ error: 'ASSIGNED_RIDER_REQUIRED' })
    const updated = await prisma.$transaction(async (transaction) => {
      const changedCount = await transaction.order.updateMany({ where: { id: order.id, status: order.status }, data: { status: result.data.status } })
      if (changedCount.count !== 1) throw Object.assign(new Error('Order state changed while this request was processing.'), { status: 409, code: 'ORDER_STATE_CHANGED' })
      const changed = await transaction.order.findUnique({ where: { id: order.id } })
      const labels = { RESTAURANT_ACCEPTED: 'Restaurant accepted your order', PREPARING: 'Your order is being prepared', READY_FOR_PICKUP: 'Your order is ready for pickup', RIDER_ASSIGNED: 'A rider has been assigned to your order', PICKED_UP: 'Your order has been picked up', OUT_FOR_DELIVERY: 'Your order is out for delivery', DELIVERED: 'Your order has arrived', CANCELLED: 'Your order was cancelled' }
      await transaction.notification.create({ data: { userId: order.customerId, type: result.data.status === 'CANCELLED' ? 'ORDER' : 'DELIVERY', title: labels[result.data.status] || 'Order status updated', body: `Order ${order.orderNumber} is now ${result.data.status.replaceAll('_', ' ').toLowerCase()}.` } })
      return changed
    })
    return response.json({ order: updated })
  } catch {
    return response.status(503).json({ error: 'ORDER_SERVICE_UNAVAILABLE' })
  }
})

app.use((_request, response) => response.status(404).json({ error: 'NOT_FOUND' }))

app.use((error, _request, response, next) => {
  if (error instanceof multer.MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400
    return response.status(status).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'DOCUMENT_TOO_LARGE' : 'INVALID_UPLOAD' })
  }
  if (error?.code === 'CORS_ORIGIN_DENIED') return response.status(403).json({ error: 'CORS_ORIGIN_NOT_ALLOWED' })
  if (error?.type === 'entity.parse.failed') return response.status(400).json({ error: 'INVALID_JSON' })
  console.error('[api:error]', error?.message || 'Unexpected API error')
  return response.status(error?.status && error.status >= 400 && error.status < 600 ? error.status : 500).json({ error: error?.code || 'INTERNAL_SERVER_ERROR' })
})

function publicUser(user) { return { id: user.id, email: user.email, phone: user.phone, firstName: user.firstName, lastName: user.lastName, preferredName: user.preferredName || null, dateOfBirth: user.dateOfBirth || null, dietaryPreference: user.dietaryPreference || null, deliveryNotes: user.deliveryNotes || null, role: user.role, status: user.status, profileImageKey: user.profileImageKey || null } }
function automatedSupportReply(category, body) { return buildAiReply(body, category) }

async function quoteOrder(input) {
  const [restaurant, address, menuItems, activeServiceArea] = await Promise.all([
    prisma.restaurant.findUnique({ where: { id: input.restaurantId }, include: { city: { include: { serviceAreas: true } } } }),
    prisma.address.findFirst({ where: { id: input.addressId, userId: input.customerId } }),
    prisma.menuItem.findMany({ where: { id: { in: input.items.map((item) => item.menuItemId) }, restaurantId: input.restaurantId, available: true } }),
    prisma.serviceArea.findFirst({ where: { enabled: true }, orderBy: { createdAt: 'asc' } }),
  ])
  if (!restaurant || restaurant.status !== 'APPROVED') throw Object.assign(new Error('Restaurant is not available.'), { status: 409, code: 'RESTAURANT_UNAVAILABLE' })
  if (!isRestaurantOpen(restaurant)) throw Object.assign(new Error('This restaurant is currently closed. Please try again during its opening hours.'), { status: 409, code: 'RESTAURANT_CLOSED' })
  if (!activeServiceArea || restaurant.cityId !== activeServiceArea.cityId) throw Object.assign(new Error('DOORSTEP is currently unavailable in this restaurant location.'), { status: 409, code: 'SERVICE_AREA_UNAVAILABLE' })
  if (address?.cityId && address.cityId !== activeServiceArea.cityId) throw Object.assign(new Error('This delivery address is outside the active DOORSTEP service area.'), { status: 409, code: 'ADDRESS_OUTSIDE_SERVICE_AREA' })
  if (!address && !input.addressLine) throw Object.assign(new Error('Delivery address is required.'), { status: 400, code: 'ADDRESS_REQUIRED' })
  if (menuItems.length !== input.items.length) throw Object.assign(new Error('One or more menu items are unavailable.'), { status: 409, code: 'MENU_ITEM_UNAVAILABLE' })
  const items = input.items.map((inputItem) => { const menuItem = menuItems.find((item) => item.id === inputItem.menuItemId); return { menuItemId: menuItem.id, name: menuItem.name, unitPriceMinor: menuItem.priceMinor, quantity: inputItem.quantity, instructions: inputItem.instructions } })
  const subtotalMinor = items.reduce((sum, item) => sum + item.unitPriceMinor * item.quantity, 0)
  const deliveryFeeMinor = 80000
  const serviceFeeMinor = Math.round(subtotalMinor * 0.03)
  return { restaurantId: restaurant.id, address, serviceAreaCityId: activeServiceArea.cityId, items, subtotalMinor, deliveryFeeMinor, serviceFeeMinor, totalMinor: subtotalMinor + deliveryFeeMinor + serviceFeeMinor }
}

function isRestaurantOpen(restaurant, now = new Date()) {
  if (restaurant.temporarilyClosed) return false
  if (!restaurant.openingTime || !restaurant.closingTime) return true
  const timezone = restaurant.city?.serviceAreas?.find((area) => area.enabled)?.timezone || 'Africa/Lagos'
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const dayNames = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']
  const daysOpen = Array.isArray(restaurant.daysOpen) ? restaurant.daysOpen : dayNames
  if (!daysOpen.includes(values.weekday.toUpperCase())) return false
  const current = Number(values.hour) * 60 + Number(values.minute)
  const [openHour, openMinute] = restaurant.openingTime.split(':').map(Number)
  const [closeHour, closeMinute] = restaurant.closingTime.split(':').map(Number)
  const opening = openHour * 60 + openMinute
  const closing = closeHour * 60 + closeMinute
  return closing >= opening ? current >= opening && current <= closing : current >= opening || current <= closing
}

export { app }

if (process.env.NODE_ENV !== 'test') {
  const host = process.env.API_HOST || '0.0.0.0'
  app.listen(port, host, () => {
    console.log(`DOORSTEP API listening on http://${host}:${port}`)
  })
}
