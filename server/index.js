import dotenv from 'dotenv'
dotenv.config()
import { randomUUID } from 'node:crypto'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import multer from 'multer'
import { z } from 'zod'
import { prisma } from './prisma.js'
import { createSession, hashPassword, requireUser, revokeSession, revokeUserSessions, verifyPassword } from './auth.js'
import { initializePayment, isOrderPayable, matchesPaystackPayment, PaymentError, verifyPaystackTransaction, verifyWebhookSignature } from './paymentService.js'
import { advanceDelivery, claimDelivery, getDeliveryTrackingSnapshot, recordLocation, validateLocationUpdate } from './deliveryService.js'
import { deliveryRealtime } from './realtime.js'
import { requireAdmin, reviewApplication } from './adminService.js'
import { readPrivateDocument, storePrivateDocument, uploadError } from './uploadService.js'
import { menuMediaUrl, publicMenuItems, publicRestaurantImage, registerPartnerMedia } from './partnerMedia.js'
import { issueVerificationCode, verificationFailure, verifyCode } from './verificationService.js'
import { buildAiReply } from './aiBrain.js'
import { createNavigationRouter } from './navigation.js'
import { applyPaystackVerification, confirmParcelPayment, createParcelRouter, rotatePaymentReference } from './parcelRoutes.js'
import { completeCardVerification, createCardRouter } from './cardRoutes.js'
import { saveCardFromAuthorization } from './cardService.js'
import { availableRiderUserIds, notifyAdmins, notifyUsers, restaurantTeamIds, sendWelcome } from './notify.js'

const app = express()
const port = Number(process.env.PORT || process.env.API_PORT || 4000)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 5 } })
const authFlowLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (request, response) => {
    const error = request.path === '/api/auth/verification/request' ? 'VERIFICATION_REQUEST_RATE_LIMITED' : 'AUTH_RATE_LIMITED'
    console.warn('[auth] rate_limited', JSON.stringify({ endpoint: request.path, error }))
    return response.status(429).json({ error })
  },
})
const publicTrackingLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false })
const onboardingLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false })
const locationSearchLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 50, standardHeaders: 'draft-7', legacyHeaders: false, handler: (_request, response) => response.status(429).json({ error: 'LOCATION_SEARCH_RATE_LIMITED' }) })
const trustedDeployedWebOrigins = new Set([
  'https://mydoorstep-web.onrender.com',
  'https://mydoorstep-site-20260922.eyedofejiro10.workers.dev',
  'https://mydoorstep.com.co',
])
const configuredWebOrigins = () => new Set([
  ...trustedDeployedWebOrigins,
  ...['WEB_ORIGIN', 'WEB_ORIGINS']
    .flatMap((key) => (process.env[key] || '').split(','))
    .map((origin) => origin.trim())
    .filter(Boolean),
])

app.set('trust proxy', 1)
app.use(helmet())
app.use(cors({ origin: (origin, callback) => {
  if (!origin || configuredWebOrigins().has(origin) || (process.env.NODE_ENV !== 'production' && /^http:\/\/localhost:517[3-9]$/.test(origin))) return callback(null, true)
  return callback(Object.assign(new Error('CORS origin not allowed'), { code: 'CORS_ORIGIN_DENIED' }))
} }))
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }))
app.use(express.json({ limit: '1mb', verify: (request, _response, buffer) => { request.rawBody = buffer } }))
app.use('/api', (request, response, next) => { if (request.method !== 'GET' || request.headers.authorization) response.set('Cache-Control', 'no-store'); next() })
app.use('/api/navigation', createNavigationRouter())
app.use('/api', createParcelRouter({ prisma, requireUser, requireAdmin, getPaymentSettings, hasValidBankTransferConfig, realtime: deliveryRealtime }))

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

const googleLocationQuery = z.object({ query: z.string().trim().min(3).max(160) })
const googlePlaceId = z.object({ placeId: z.string().regex(/^ChI[A-Za-z0-9_-]+$/).max(200) })

app.get('/api/locations/google/autocomplete', locationSearchLimiter, async (request, response) => {
  const query = googleLocationQuery.safeParse(request.query)
  if (!query.success) return response.status(400).json({ error: 'INVALID_LOCATION_QUERY' })
  if (!process.env.GOOGLE_MAPS_API_KEY) return response.status(503).json({ error: 'GOOGLE_PLACES_UNAVAILABLE' })
  try {
    const googleResponse = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat',
      },
      body: JSON.stringify({
        input: query.data.query,
        includedRegionCodes: ['ng'],
        locationBias: { circle: { center: { latitude: 5.8916, longitude: 5.6846 }, radius: 50000 } },
      }),
    })
    if (!googleResponse.ok) {
      console.warn('[locations] google_autocomplete_failed', JSON.stringify({ status: googleResponse.status }))
      return response.status(502).json({ error: 'GOOGLE_PLACES_UNAVAILABLE' })
    }
    const data = await googleResponse.json()
    const results = (data.suggestions || [])
      .map((suggestion) => suggestion.placePrediction)
      .filter((prediction) => prediction?.placeId && prediction.text?.text)
      .slice(0, 5)
      .map((prediction) => ({
        placeId: prediction.placeId,
        label: prediction.text.text,
        secondaryLabel: prediction.structuredFormat?.secondaryText?.text || '',
      }))
    response.set('Cache-Control', 'private, max-age=30')
    return response.json({ results })
  } catch (error) {
    console.error('[locations] google_autocomplete_error', JSON.stringify({ name: error.name }))
    return response.status(503).json({ error: 'GOOGLE_PLACES_UNAVAILABLE' })
  }
})

app.get('/api/locations/google/:placeId', locationSearchLimiter, async (request, response) => {
  const place = googlePlaceId.safeParse(request.params)
  if (!place.success) return response.status(400).json({ error: 'INVALID_GOOGLE_PLACE' })
  if (!process.env.GOOGLE_MAPS_API_KEY) return response.status(503).json({ error: 'GOOGLE_PLACES_UNAVAILABLE' })
  try {
    const googleResponse = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(place.data.placeId)}`, {
      headers: {
        'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'displayName,formattedAddress,location',
      },
    })
    if (!googleResponse.ok) {
      console.warn('[locations] google_place_failed', JSON.stringify({ status: googleResponse.status }))
      return response.status(502).json({ error: 'GOOGLE_PLACE_UNAVAILABLE' })
    }
    const data = await googleResponse.json()
    if (!Number.isFinite(data.location?.latitude) || !Number.isFinite(data.location?.longitude)) return response.status(404).json({ error: 'GOOGLE_PLACE_LOCATION_UNAVAILABLE' })
    response.set('Cache-Control', 'private, max-age=300')
    return response.json({
      location: {
        latitude: data.location.latitude,
        longitude: data.location.longitude,
        label: data.formattedAddress || data.displayName?.text || 'Selected Google place',
      },
    })
  } catch (error) {
    console.error('[locations] google_place_error', JSON.stringify({ name: error.name }))
    return response.status(503).json({ error: 'GOOGLE_PLACE_UNAVAILABLE' })
  }
})

function publicRestaurant(restaurant) {
  const items = publicMenuItems(restaurant)
  return {
    id: restaurant.id,
    name: restaurant.name,
    slug: restaurant.slug,
    description: restaurant.description,
    cuisine: restaurant.cuisineCategory,
    image: publicRestaurantImage(restaurant),
    type: restaurant.storeType,
    address: restaurant.address,
    city: restaurant.city?.name || null,
    rating: Number(restaurant.ratingAverage),
    ratingCount: restaurant.ratingCount,
    openingTime: restaurant.openingTime,
    closingTime: restaurant.closingTime,
    prepTimeMinutes: restaurant.prepTimeMinutes,
    minimumOrderMinor: restaurant.minimumOrderMinor,
    temporarilyClosed: restaurant.temporarilyClosed,
    openNow: isRestaurantOpen(restaurant),
    categories: restaurant.categories.map((category) => category.name),
    items,
  }
}

app.get('/api/restaurants', async (request, response) => {
  const result = z.object({ search: z.string().max(100).optional(), type: z.enum(['RESTAURANT', 'GROCERY']).optional(), limit: z.coerce.number().int().min(1).max(50).default(24) }).safeParse(request.query)
  if (!result.success) return response.status(400).json({ error: 'INVALID_RESTAURANT_QUERY' })
  try {
    const restaurants = await prisma.restaurant.findMany({ where: { status: 'APPROVED', ...(result.data.type ? { storeType: result.data.type } : {}), ...(result.data.search ? { OR: [{ name: { contains: result.data.search, mode: 'insensitive' } }, { description: { contains: result.data.search, mode: 'insensitive' } }] } : {}) }, include: { city: true, users: { where: { role: 'OWNER' }, orderBy: { createdAt: 'asc' }, select: { userId: true, user: { select: { profileImageKey: true } } } }, menuItems: { where: { categoryId: null, available: true } }, categories: { include: { items: { where: { available: true } } } } }, orderBy: { ratingAverage: 'desc' }, take: result.data.limit })
    response.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
    return response.json({ restaurants: restaurants.map(publicRestaurant) })
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

const defaultPaymentSettings = {
  bankTransfer: {
    enabled: false,
    bankName: '',
    accountName: '',
    accountNumber: '',
    currency: 'NGN',
    instructions: '',
    expiryMinutes: null,
    verificationMethod: 'MANUAL',
    automaticVerification: false,
  },
  cashOnDelivery: { enabled: false },
}

function hasValidBankTransferConfig(bankTransfer) {
  return Boolean(
    bankTransfer?.bankName?.trim()
    && bankTransfer?.accountName?.trim()
    && /^\d{6,24}$/.test((bankTransfer?.accountNumber || '').replace(/\s/g, ''))
    && bankTransfer?.currency === 'NGN'
    && bankTransfer?.verificationMethod === 'MANUAL',
  )
}

async function getPaymentSettings() {
  const record = await prisma.platformSetting.findUnique({ where: { key: 'payment_settings' } })
  return {
    ...defaultPaymentSettings,
    ...(record?.value && typeof record.value === 'object' ? record.value : {}),
    bankTransfer: { ...defaultPaymentSettings.bankTransfer, ...(record?.value?.bankTransfer || {}) },
    cashOnDelivery: { ...defaultPaymentSettings.cashOnDelivery, ...(record?.value?.cashOnDelivery || {}) },
  }
}

function publicPaymentConfiguration(settings) {
  const paystackConfigured = Boolean(process.env.PAYSTACK_SECRET_KEY)
  return {
    provider: process.env.PAYMENT_PROVIDER || process.env.PAYMENTS_PROVIDER || 'paystack',
    configured: paystackConfigured,
    methods: {
      paystack: { enabled: paystackConfigured },
      bankTransfer: { enabled: Boolean(settings.bankTransfer.enabled && hasValidBankTransferConfig(settings.bankTransfer)) },
      cashOnDelivery: { enabled: false },
    },
  }
}

const paymentSettingsSchema = z.object({
  bankTransfer: z.object({
    enabled: z.boolean(),
    bankName: z.string().trim().max(120),
    accountName: z.string().trim().max(160),
    accountNumber: z.string().trim().max(24),
    currency: z.literal('NGN'),
    instructions: z.string().trim().max(1000),
    expiryMinutes: z.number().int().min(5).max(10080).nullable(),
    verificationMethod: z.literal('MANUAL'),
    automaticVerification: z.literal(false),
  }),
  cashOnDelivery: z.object({ enabled: z.boolean() }),
})

app.get('/api/payments/config', async (_request, response) => {
  try {
    return response.json(publicPaymentConfiguration(await getPaymentSettings()))
  } catch {
    return response.status(503).json({ error: 'PAYMENT_CONFIGURATION_UNAVAILABLE' })
  }
})

app.get('/api/admin/payment-settings', requireUser, requireAdmin, async (_request, response) => {
  try {
    const settings = await getPaymentSettings()
    return response.json({
      settings,
      paystack: {
        configured: Boolean(process.env.PAYSTACK_SECRET_KEY),
        mode: process.env.PAYSTACK_SECRET_KEY?.startsWith('sk_live_') ? 'live' : process.env.PAYSTACK_SECRET_KEY ? 'test' : 'not_configured',
      },
    })
  } catch {
    return response.status(503).json({ error: 'PAYMENT_CONFIGURATION_UNAVAILABLE' })
  }
})

app.patch('/api/admin/payment-settings', requireUser, requireAdmin, async (request, response) => {
  const result = paymentSettingsSchema.safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_PAYMENT_SETTINGS', details: result.error.flatten() })
  const { bankTransfer } = result.data
  if (bankTransfer.enabled && !hasValidBankTransferConfig(bankTransfer)) return response.status(409).json({ error: 'BANK_TRANSFER_CONFIGURATION_REQUIRED', message: 'Bank name, account name, account number, NGN currency, and manual verification are required before enabling bank transfer.' })
  try {
    const settings = await prisma.$transaction(async (transaction) => {
      const saved = await transaction.platformSetting.upsert({ where: { key: 'payment_settings' }, update: { value: result.data }, create: { key: 'payment_settings', value: result.data } })
      await transaction.auditLog.create({ data: { actorId: request.user.id, action: 'UPDATE_PAYMENT_SETTINGS', entityType: 'PlatformSetting', entityId: saved.id, metadata: { bankTransferEnabled: bankTransfer.enabled, automaticVerification: false, cashOnDeliveryEnabled: result.data.cashOnDelivery.enabled } } })
      return saved.value
    })
    return response.json({ settings })
  } catch {
    return response.status(503).json({ error: 'PAYMENT_CONFIGURATION_UNAVAILABLE' })
  }
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
    const keyPrefix = request.file.mimetype.startsWith('image/') ? `private/users/${request.user.id}` : 'private/documents'
    const stored = await storePrivateDocument({ buffer: request.file.buffer, mimeType: request.file.mimetype, originalName: request.file.originalname, keyPrefix })
    return response.status(201).json({ storageKey: stored.storageKey, checksum: stored.checksum, mimeType: stored.mimeType, size: stored.size })
  } catch (error) {
    return response.status(error.status || 503).json({ error: error.code || 'UPLOAD_SERVICE_UNAVAILABLE', message: error.message })
  }
})

const credentialsSchema = z.object({ email: z.string().email().transform((value) => value.toLowerCase()), password: z.string().min(8), firstName: z.string().min(1).max(80).optional(), lastName: z.string().min(1).max(80).optional(), phone: z.string().min(7).max(30).optional() })
const customerRegistrationSchema = credentialsSchema.extend({
  verificationId: z.string().min(1),
  termsAccepted: z.literal(true),
  password: z.string().min(10).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/),
})
export const orderSchema = z.object({ restaurantId: z.string().min(1), items: z.array(z.object({ menuItemId: z.string().min(1), quantity: z.number().int().positive().max(50), instructions: z.string().max(500).optional() })).min(1), paymentMethod: z.enum(['PAYSTACK', 'BANK_TRANSFER', 'CASH_ON_DELIVERY']).default('PAYSTACK'), addressId: z.string().min(1).optional(), addressLine: z.string().min(5).max(240).optional(), phone: z.string().min(7).max(30).optional(), landmark: z.string().max(200).optional(), latitude: z.number().gte(-90).lte(90).optional(), longitude: z.number().gte(-180).lte(180).optional() }).superRefine((value, context) => {
  if ((value.latitude == null) !== (value.longitude == null)) context.addIssue({ code: 'custom', path: [value.latitude == null ? 'latitude' : 'longitude'], message: 'Both destination coordinates are required.' })
})
export const addressSchema = z.object({ label: z.string().min(1).max(40), addressLine: z.string().min(5).max(240), landmark: z.string().max(200).optional(), latitude: z.number().gte(-90).lte(90).optional(), longitude: z.number().gte(-180).lte(180).optional(), cityId: z.string().min(1).optional() }).superRefine((value, context) => {
  if ((value.latitude == null) !== (value.longitude == null)) context.addIssue({ code: 'custom', path: [value.latitude == null ? 'latitude' : 'longitude'], message: 'Both address coordinates are required.' })
})
const privateDocumentSchema = z.object({ type: z.string().min(2).max(80), storageKey: z.string().startsWith('private/applications/').max(500) })
const optionalText = (max) => z.string().trim().max(max).optional().transform((value) => value || null)
const optionalNumber = ({ min = 0, max }) => z.preprocess((value) => value === '' || value === undefined ? undefined : Number(value), z.number().finite().min(min).max(max).optional())
const optionalTime = z.preprocess((value) => value === '' || value === undefined ? undefined : value, z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional())
const openingDays = z.preprocess((value) => value === '' || value === undefined ? [] : Array.isArray(value) ? value : [value], z.array(z.enum(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'])).max(7).default([]))
const deliveryPreferenceSchema = z.enum(['DOORSTEP_RIDERS', 'OWN_RIDERS', 'BOTH'])
const acceptedTermsSchema = z.union([z.literal('on'), z.literal('true'), z.literal(true)])
const partnerApplicationFieldsSchema = z.object({ restaurantName: z.string().min(2).max(120), businessType: optionalText(60), registrationNumber: optionalText(100), businessPhone: z.string().min(7).max(30), businessEmail: z.string().email(), whatsApp: optionalText(30), address: z.string().min(5).max(240), cityName: z.string().default('Sapele'), businessDescription: optionalText(1000), cuisineCategory: optionalText(100), openingTime: optionalTime, closingTime: optionalTime, openingDays, prepTimeMinutes: optionalNumber({ min: 1, max: 240 }), minimumOrder: optionalNumber({ min: 0, max: 500000 }), deliveryPreference: deliveryPreferenceSchema, ownerName: z.string().min(2).max(120), ownerIdentityType: optionalText(60), ownerIdentityNumber: optionalText(120), verificationId: z.string().min(1), password: z.string().min(8), confirmPassword: z.string().min(8), termsAccepted: acceptedTermsSchema, documents: z.array(privateDocumentSchema).max(5).default([]) })
const requireCompleteOpeningHours = (schema) => schema.superRefine((data, context) => {
  if (Boolean(data.openingTime) !== Boolean(data.closingTime)) context.addIssue({ code: 'custom', path: ['openingTime'], message: 'Provide both opening and closing times.' })
})
function logApplicationValidationFailure(applicationType, error) {
  const details = error.flatten()
  console.warn(`[${applicationType}-application] validation_rejected`, JSON.stringify({
    fields: Object.keys(details.fieldErrors),
    formErrorCount: details.formErrors.length,
  }))
}
const groceryApplicationFieldsSchema = partnerApplicationFieldsSchema.extend({ groceryName: z.string().min(2).max(120), businessType: z.preprocess((value) => value === '' ? undefined : value, z.enum(['supermarket', 'mini_market', 'produce_market', 'pharmacy', 'specialty_store']).optional().transform((value) => value || null)), cuisineCategory: optionalText(100).optional(), prepTimeMinutes: optionalNumber({ min: 1, max: 240 }).optional(), minimumOrder: optionalNumber({ min: 0, max: 500000 }).optional() })
const partnerApplicationMultipartSchema = requireCompleteOpeningHours(partnerApplicationFieldsSchema.omit({ documents: true }))
const groceryApplicationMultipartSchema = requireCompleteOpeningHours(groceryApplicationFieldsSchema.omit({ documents: true }))
const partnerApplicationJsonSchema = requireCompleteOpeningHours(partnerApplicationFieldsSchema.extend({ documents: z.array(z.never()).max(0).default([]) }))
const riderApplicationSchema = z.object({ firstName: z.string().min(1).max(80), lastName: z.string().min(1).max(80), email: z.string().email(), phone: z.string().min(7).max(30), address: z.string().min(5).max(240), preferredArea: z.string().min(2).max(160), preferredLanguage: optionalText(60), vehicleType: z.enum(['bicycle', 'motorcycle', 'car', 'other']), vehicleOwnership: z.enum(['OWNED', 'PERMITTED']), typicalAvailability: z.string().min(2).max(120), identityType: optionalText(60), identityNumber: optionalText(120), vehicleRegistration: optionalText(100), emergencyName: optionalText(120), emergencyPhone: optionalText(30), verificationId: z.string().min(1), password: z.string().min(8), confirmPassword: z.string().min(8), termsAccepted: acceptedTermsSchema, documents: z.array(privateDocumentSchema).max(5).default([]) })
const riderApplicationJsonSchema = riderApplicationSchema.extend({ documents: z.array(z.never()).max(0).default([]) })
const passwordsMatch = (data, response) => {
  if (data.password === data.confirmPassword) return true
  response.status(400).json({ error: 'PASSWORD_CONFIRMATION_MISMATCH' })
  return false
}
const verificationRequestSchema = z.object({ destination: z.string().min(6), channel: z.enum(['email', 'phone']) }).superRefine(({ destination, channel }, context) => {
  if (channel === 'phone' && !/^\+[1-9]\d{7,14}$/.test(destination)) context.addIssue({ code: 'custom', path: ['destination'], message: 'Phone verification requires an E.164 phone number.' })
})
const verificationSchema = z.object({ challengeId: z.string().min(1), destination: z.string().min(6), code: z.string().regex(/^\d{6}$/) })

export async function storeApplicationDocuments(files = []) {
  if (files.length > 5) throw Object.assign(new Error('At most five verification documents can be uploaded.'), { code: 'APPLICATION_DOCUMENTS_INVALID', status: 400 })
  return Promise.all(files.map((file, index) => storePrivateDocument({ buffer: file.buffer, mimeType: file.mimetype, originalName: file.originalname, keyPrefix: 'private/applications' }).then((stored) => ({ type: index === 0 ? 'IDENTITY' : 'BUSINESS_OR_VEHICLE', storageKey: stored.storageKey }))))
}

async function requireVerifiedApplicationEmail(verificationId, email) {
  const verification = await prisma.verificationCode.findFirst({
    where: { id: verificationId, destination: email.toLowerCase(), channel: 'email', verifiedAt: { not: null }, expiresAt: { gt: new Date() } },
  })
  if (!verification) throw Object.assign(new Error('A verified email code is required.'), { code: 'APPLICATION_EMAIL_VERIFICATION_REQUIRED', status: 400 })
}

app.post('/api/auth/verification/request', authFlowLimiter, async (request, response) => {
  const result = verificationRequestSchema.safeParse(request.body)
  if (!result.success) {
    console.warn('[verification] request_rejected', JSON.stringify({ error: 'INVALID_VERIFICATION_REQUEST' }))
    return response.status(400).json({ error: 'INVALID_VERIFICATION_REQUEST' })
  }
  try {
    return response.status(201).json(await issueVerificationCode(result.data))
  } catch (error) {
    const failure = verificationFailure(error)
    console.warn('[verification] request_failed', JSON.stringify({ channel: result.data.channel, code: failure.code }))
    return response.status(failure.status).json({ error: failure.code })
  }
})
app.post('/api/auth/verification/verify', authFlowLimiter, async (request, response) => {
  const result = verificationSchema.safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_VERIFICATION_CODE' })
  try { return response.json({ verified: await verifyCode(result.data) }) } catch (error) { return response.status(verificationFailure(error).status).json({ error: verificationFailure(error).code }) }
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
  const result = partnerApplicationJsonSchema.safeParse(request.body)
  if (!result.success) {
    logApplicationValidationFailure('partner', result.error)
    return response.status(400).json({ error: 'INVALID_PARTNER_APPLICATION', details: result.error.flatten() })
  }
  if (!passwordsMatch(result.data, response)) return
  try {
    const data = result.data
    await requireVerifiedApplicationEmail(data.verificationId, data.businessEmail)
    const city = await prisma.city.findFirst({ where: { name: data.cityName } })
    if (!city) return response.status(400).json({ error: 'CITY_NOT_SUPPORTED' })
    const slug = `${data.restaurantName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${randomUUID().slice(0, 6)}`
    const created = await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({ data: { email: data.businessEmail, phone: data.businessPhone, passwordHash: await hashPassword(data.password), firstName: data.ownerName.split(' ')[0], lastName: data.ownerName.split(' ').slice(1).join(' ') || data.ownerName, emailVerifiedAt: new Date(), role: 'RESTAURANT' } })
      const restaurant = await transaction.restaurant.create({ data: { name: data.restaurantName, slug, description: data.businessDescription, cuisineCategory: data.cuisineCategory, openingTime: data.openingTime, closingTime: data.closingTime, daysOpen: data.openingDays, prepTimeMinutes: data.prepTimeMinutes, minimumOrderMinor: Math.round((data.minimumOrder || 0) * 100), address: data.address, email: data.businessEmail, phone: data.businessPhone, cityId: city.id, application: { create: { ownerName: data.ownerName, ownerPhone: data.businessPhone, ownerEmail: data.businessEmail, businessCategory: data.businessType, registrationNumber: data.registrationNumber, whatsApp: data.whatsApp, identityType: data.ownerIdentityType, identityNumber: data.ownerIdentityNumber, deliveryPreference: data.deliveryPreference } } } })
      await transaction.restaurantUser.create({ data: { userId: user.id, restaurantId: restaurant.id } })
      await sendWelcome(transaction, user, { businessName: restaurant.name, storeType: 'RESTAURANT' })
      await notifyAdmins(transaction, { type: 'ACCOUNT', title: 'New restaurant application', body: `${restaurant.name} (${data.cityName}) applied to sell on DOORSTEP.`, link: '/admin/restaurants' })
      return { restaurantId: restaurant.id, status: 'PENDING_APPROVAL' }
    })
    return response.status(201).json(created)
  } catch (error) {
    if (error.code === 'P2002') return response.status(409).json({ error: 'PARTNER_ACCOUNT_ALREADY_EXISTS' })
    return response.status(error.status || 503).json({ error: error.code || 'PARTNER_APPLICATION_UNAVAILABLE' })
  }
})

app.post('/api/partner-applications/multipart', onboardingLimiter, upload.array('documents', 5), async (request, response) => {
  try {
    const fields = partnerApplicationMultipartSchema.safeParse(request.body)
    if (!fields.success) {
      logApplicationValidationFailure('partner', fields.error)
      return response.status(400).json({ error: 'INVALID_PARTNER_APPLICATION', details: fields.error.flatten() })
    }
    if (!passwordsMatch(fields.data, response)) return
    const data = fields.data
    await requireVerifiedApplicationEmail(data.verificationId, data.businessEmail)
    const city = await prisma.city.findFirst({ where: { name: data.cityName } })
    if (!city) return response.status(400).json({ error: 'CITY_NOT_SUPPORTED' })
    const documents = await storeApplicationDocuments(request.files)
    const slug = `${data.restaurantName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${randomUUID().slice(0, 6)}`
    const created = await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({ data: { email: data.businessEmail, phone: data.businessPhone, passwordHash: await hashPassword(data.password), firstName: data.ownerName.split(' ')[0], lastName: data.ownerName.split(' ').slice(1).join(' ') || data.ownerName, emailVerifiedAt: new Date(), role: 'RESTAURANT' } })
      const restaurant = await transaction.restaurant.create({ data: { name: data.restaurantName, slug, description: data.businessDescription, cuisineCategory: data.cuisineCategory, openingTime: data.openingTime, closingTime: data.closingTime, daysOpen: data.openingDays, prepTimeMinutes: data.prepTimeMinutes, minimumOrderMinor: Math.round((data.minimumOrder || 0) * 100), address: data.address, email: data.businessEmail, phone: data.businessPhone, cityId: city.id, application: { create: { ownerName: data.ownerName, ownerPhone: data.businessPhone, ownerEmail: data.businessEmail, businessCategory: data.businessType, registrationNumber: data.registrationNumber, whatsApp: data.whatsApp, identityType: data.ownerIdentityType, identityNumber: data.ownerIdentityNumber, deliveryPreference: data.deliveryPreference, documents: { create: documents.map((document) => ({ type: document.type, storageKey: document.storageKey })) } } } } })
      await transaction.restaurantUser.create({ data: { userId: user.id, restaurantId: restaurant.id } })
      await sendWelcome(transaction, user, { businessName: restaurant.name, storeType: 'RESTAURANT' })
      await notifyAdmins(transaction, { type: 'ACCOUNT', title: 'New restaurant application', body: `${restaurant.name} (${data.cityName}) applied to sell on DOORSTEP.`, link: '/admin/restaurants' })
      return { restaurantId: restaurant.id, status: 'PENDING_APPROVAL' }
    })
    return response.status(201).json(created)
  } catch (error) {
    if (error.code === 'P2002') return response.status(409).json({ error: 'PARTNER_ACCOUNT_ALREADY_EXISTS' })
    return response.status(error.status || 503).json({ error: error.code || 'PARTNER_APPLICATION_UNAVAILABLE' })
  }
})

app.post('/api/grocery-applications/multipart', onboardingLimiter, upload.array('documents', 5), async (request, response) => {
  try {
    const fields = groceryApplicationMultipartSchema.safeParse(request.body)
    if (!fields.success) {
      logApplicationValidationFailure('grocery', fields.error)
      return response.status(400).json({ error: 'INVALID_GROCERY_APPLICATION', details: fields.error.flatten() })
    }
    if (!passwordsMatch(fields.data, response)) return
    const data = fields.data
    await requireVerifiedApplicationEmail(data.verificationId, data.businessEmail)
    const city = await prisma.city.findFirst({ where: { name: data.cityName } })
    if (!city) return response.status(400).json({ error: 'CITY_NOT_SUPPORTED' })
    const documents = await storeApplicationDocuments(request.files)
    const slug = `${data.groceryName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${randomUUID().slice(0, 6)}`
    const created = await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({ data: { email: data.businessEmail, phone: data.businessPhone, passwordHash: await hashPassword(data.password), firstName: data.ownerName.split(' ')[0], lastName: data.ownerName.split(' ').slice(1).join(' ') || data.ownerName, emailVerifiedAt: new Date(), role: 'RESTAURANT' } })
      const grocery = await transaction.restaurant.create({ data: { name: data.groceryName, slug, description: `${(data.businessType || 'grocery store').replaceAll('_', ' ')} on DOORSTEP`, storeType: 'GROCERY', openingTime: data.openingTime, closingTime: data.closingTime, daysOpen: data.openingDays, address: data.address, email: data.businessEmail, phone: data.businessPhone, cityId: city.id, application: { create: { ownerName: data.ownerName, ownerPhone: data.businessPhone, ownerEmail: data.businessEmail, businessCategory: data.businessType, registrationNumber: data.registrationNumber, deliveryPreference: data.deliveryPreference, documents: { create: documents.map((document) => ({ type: document.type, storageKey: document.storageKey })) } } } } })
      await transaction.restaurantUser.create({ data: { userId: user.id, restaurantId: grocery.id } })
      await sendWelcome(transaction, user, { businessName: grocery.name, storeType: 'GROCERY' })
      await notifyAdmins(transaction, { type: 'ACCOUNT', title: 'New grocery application', body: `${grocery.name} (${data.cityName}) applied to sell on DOORSTEP.`, link: '/admin/groceries' })
      return { groceryId: grocery.id, status: 'PENDING_APPROVAL' }
    })
    console.info('[grocery-application] submitted', JSON.stringify({ groceryId: created.groceryId }))
    return response.status(201).json(created)
  } catch (error) {
    if (error.code === 'P2002') return response.status(409).json({ error: 'GROCERY_OWNER_ACCOUNT_ALREADY_EXISTS' })
    return response.status(error.status || 503).json({ error: error.code || 'GROCERY_APPLICATION_UNAVAILABLE' })
  }
})

app.post('/api/rider-applications', async (request, response) => {
  const result = riderApplicationJsonSchema.safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_RIDER_APPLICATION', details: result.error.flatten() })
  if (!passwordsMatch(result.data, response)) return
  try {
    const data = result.data
    await requireVerifiedApplicationEmail(data.verificationId, data.email)
    const created = await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({ data: { email: data.email, phone: data.phone, passwordHash: await hashPassword(data.password), firstName: data.firstName, lastName: data.lastName, preferredLanguage: data.preferredLanguage, emailVerifiedAt: new Date(), role: 'RIDER' } })
      const rider = await transaction.rider.create({ data: { userId: user.id, vehicleType: data.vehicleType, vehicleDetails: data.vehicleRegistration, application: { create: { identityType: data.identityType, identityNumber: data.identityNumber, emergencyName: data.emergencyName, emergencyPhone: data.emergencyPhone, preferredArea: data.preferredArea, typicalAvailability: data.typicalAvailability, vehicleOwnership: data.vehicleOwnership, identityDocuments: { create: data.documents.map((document) => ({ type: document.type, storageKey: document.storageKey })) } } } } })
      await sendWelcome(transaction, user)
      await notifyAdmins(transaction, { type: 'ACCOUNT', title: 'New rider application', body: `${data.firstName} ${data.lastName} applied to ride (${String(data.vehicleType).toLowerCase()}).`, link: '/admin/riders' })
      return { riderId: rider.id, status: 'PENDING_APPROVAL' }
    })
    return response.status(201).json(created)
  } catch (error) {
    if (error.code === 'P2002') return response.status(409).json({ error: 'RIDER_ACCOUNT_ALREADY_EXISTS' })
    return response.status(error.status || 503).json({ error: error.code || 'RIDER_APPLICATION_UNAVAILABLE' })
  }
})

app.post('/api/rider-applications/multipart', onboardingLimiter, upload.array('documents', 5), async (request, response) => {
  try {
    const fields = riderApplicationSchema.omit({ documents: true }).safeParse(request.body)
    if (!fields.success) {
      logApplicationValidationFailure('rider', fields.error)
      return response.status(400).json({ error: 'INVALID_RIDER_APPLICATION', details: fields.error.flatten() })
    }
    if (!passwordsMatch(fields.data, response)) return
    const data = fields.data
    await requireVerifiedApplicationEmail(data.verificationId, data.email)
    const documents = await storeApplicationDocuments(request.files)
    const created = await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({ data: { email: data.email, phone: data.phone, passwordHash: await hashPassword(data.password), firstName: data.firstName, lastName: data.lastName, preferredLanguage: data.preferredLanguage, emailVerifiedAt: new Date(), role: 'RIDER' } })
      const rider = await transaction.rider.create({ data: { userId: user.id, vehicleType: data.vehicleType, vehicleDetails: data.vehicleRegistration, application: { create: { identityType: data.identityType, identityNumber: data.identityNumber, emergencyName: data.emergencyName, emergencyPhone: data.emergencyPhone, preferredArea: data.preferredArea, typicalAvailability: data.typicalAvailability, vehicleOwnership: data.vehicleOwnership, identityDocuments: { create: documents.map((document) => ({ type: document.type, storageKey: document.storageKey })) } } } } })
      await sendWelcome(transaction, user)
      await notifyAdmins(transaction, { type: 'ACCOUNT', title: 'New rider application', body: `${data.firstName} ${data.lastName} applied to ride (${String(data.vehicleType).toLowerCase()}).`, link: '/admin/riders' })
      return { riderId: rider.id, status: 'PENDING_APPROVAL' }
    })
    return response.status(201).json(created)
  } catch (error) {
    if (error.code === 'P2002') return response.status(409).json({ error: 'RIDER_ACCOUNT_ALREADY_EXISTS' })
    return response.status(error.status || 503).json({ error: error.code || 'RIDER_APPLICATION_UNAVAILABLE' })
  }
})

app.post('/api/auth/register', async (request, response) => {
  const result = customerRegistrationSchema.safeParse(request.body)
  if (!result.success || !result.data.firstName || !result.data.lastName) return response.status(400).json({ error: 'INVALID_REGISTRATION', details: result.success ? 'First and last name are required.' : result.error.flatten() })
  try {
    const verification = await prisma.verificationCode.findFirst({ where: { id: result.data.verificationId, verifiedAt: { not: null }, expiresAt: { gt: new Date() } } })
    if (!verification || (verification.destination !== result.data.email && verification.destination !== result.data.phone?.toLowerCase())) return response.status(400).json({ error: 'ACCOUNT_VERIFICATION_REQUIRED' })
    const user = await prisma.user.create({ data: { email: result.data.email, phone: result.data.phone, passwordHash: await hashPassword(result.data.password), firstName: result.data.firstName, lastName: result.data.lastName, emailVerifiedAt: verification.channel === 'email' ? new Date() : null, phoneVerifiedAt: verification.channel === 'phone' ? new Date() : null, role: 'CUSTOMER', customer: { create: {} } } })
    await sendWelcome(prisma, user).catch(() => undefined)
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
    const user = await prisma.user.findUnique({ where: { email: result.data.email }, include: { rider: true, restaurantUsers: { include: { restaurant: true } } } })
    if (!user || !(await verifyPassword(result.data.password, user.passwordHash)) || user.status !== 'ACTIVE') return response.status(401).json({ error: 'INVALID_CREDENTIALS' })
    if ((user.role === 'RIDER' && user.rider?.status !== 'APPROVED') || (user.role === 'RESTAURANT' && !user.restaurantUsers.some(({ restaurant }) => restaurant.status === 'APPROVED'))) return response.status(403).json({ error: 'ACCOUNT_PENDING_APPROVAL' })
    const token = await createSession(user.id)
    // Admins are never created through sign-up, and accounts made before welcome messages existed
    // missed theirs; both get it on their next sign-in (once).
    if (user.role === 'ADMIN' || Date.now() - new Date(user.createdAt).getTime() < 30 * 86_400_000) await sendWelcome(prisma, user, { businessName: user.restaurantUsers?.[0]?.restaurant?.name, storeType: user.restaurantUsers?.[0]?.restaurant?.storeType }).catch(() => undefined)
    return response.json({ token, user: publicUser(user) })
  } catch {
    return response.status(503).json({ error: 'AUTH_SERVICE_UNAVAILABLE' })
  }
})

app.post('/api/application-status', authFlowLimiter, async (request, response) => {
  const result = credentialsSchema.pick({ email: true, password: true }).safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_APPLICATION_STATUS_REQUEST' })
  try {
    const user = await prisma.user.findUnique({
      where: { email: result.data.email },
      include: {
        rider: { include: { application: true } },
        restaurantUsers: { include: { restaurant: { include: { application: true } } } },
      },
    })
    if (!user || !(await verifyPassword(result.data.password, user.passwordHash)) || user.status !== 'ACTIVE') return response.status(401).json({ error: 'INVALID_CREDENTIALS' })
    if (user.role === 'RIDER' && user.rider?.application) {
      const application = user.rider.application
      const history = await prisma.applicationReview.findMany({ where: { applicationType: 'RIDER', applicationId: application.id }, select: { status: true, note: true, createdAt: true }, orderBy: { createdAt: 'asc' } })
      return response.json({ application: { type: 'RIDER', status: application.status, submittedAt: application.submittedAt, reviewedAt: application.reviewedAt, reviewNote: application.reviewNote || null, history } })
    }
    const application = user.restaurantUsers.map(({ restaurant }) => restaurant.application).find(Boolean)
    if (user.role === 'RESTAURANT' && application) {
      const history = await prisma.applicationReview.findMany({ where: { applicationType: 'RESTAURANT', applicationId: application.id }, select: { status: true, note: true, createdAt: true }, orderBy: { createdAt: 'asc' } })
      return response.json({ application: { type: 'PARTNER', status: application.status, submittedAt: application.submittedAt, reviewedAt: application.reviewedAt, reviewNote: application.reviewNote || null, history } })
    }
    return response.status(404).json({ error: 'APPLICATION_NOT_FOUND' })
  } catch {
    return response.status(503).json({ error: 'APPLICATION_STATUS_UNAVAILABLE' })
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
  const result = addressSchema.safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_ADDRESS', details: result.error.flatten() })
  try {
    const activeServiceArea = await prisma.serviceArea.findFirst({ where: { enabled: true }, orderBy: { createdAt: 'asc' } })
    if (!activeServiceArea) return response.status(503).json({ error: 'SERVICE_AREA_UNAVAILABLE' })
    if (result.data.cityId && !(await prisma.serviceArea.findFirst({ where: { cityId: result.data.cityId, enabled: true } }))) return response.status(400).json({ error: 'CITY_OUTSIDE_SERVICE_AREA' })
    return response.status(201).json({ address: await prisma.address.create({ data: { ...result.data, cityId: result.data.cityId || activeServiceArea.cityId, userId: request.user.id } }) })
  } catch { return response.status(503).json({ error: 'ADDRESS_SERVICE_UNAVAILABLE' }) }
})
app.patch('/api/addresses/:addressId', requireUser, async (request, response) => {
  const result = addressSchema.safeParse(request.body)
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
  try {
    await readPrivateDocument(result.data.storageKey)
    const user = await prisma.user.update({ where: { id: request.user.id }, data: { profileImageKey: result.data.storageKey } })
    return response.json({ user: publicUser(user) })
  } catch (error) { return response.status(error.status || 503).json({ error: error.code || 'PROFILE_SERVICE_UNAVAILABLE' }) }
})
app.get('/api/profile/photo', requireUser, async (request, response) => {
  if (!request.user.profileImageKey) return response.status(404).json({ error: 'PROFILE_PHOTO_NOT_FOUND' })
  try {
    if (!request.user.profileImageKey.startsWith(`private/users/${request.user.id}/`)) return response.status(403).json({ error: 'PROFILE_PHOTO_OWNERSHIP_REQUIRED' })
    const photo = await readPrivateDocument(request.user.profileImageKey)
    response.set('Content-Type', photo.mimeType)
    response.set('Cache-Control', 'private, max-age=300')
    return response.send(photo.buffer)
  } catch (error) { return response.status(error.status || 503).json({ error: error.code || 'PROFILE_PHOTO_UNAVAILABLE' }) }
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
    const unreadCount = await prisma.notification.count({ where: { userId: request.user.id, readAt: null } })
    return response.json({ notifications: rows, unreadCount, nextCursor: hasNextPage ? rows.at(-1)?.id || null : null })
  } catch { return response.status(503).json({ error: 'NOTIFICATION_SERVICE_UNAVAILABLE' }) }
})
// Cheap poll for the bell: the unread count plus anything newer than the client's last seen id.
app.get('/api/notifications/summary', requireUser, async (request, response) => {
  try {
    const since = typeof request.query.since === 'string' && request.query.since.length <= 64 ? request.query.since : null
    const anchor = since ? await prisma.notification.findFirst({ where: { id: since, userId: request.user.id }, select: { createdAt: true } }) : null
    const [unreadCount, latest] = await Promise.all([
      prisma.notification.count({ where: { userId: request.user.id, readAt: null } }),
      prisma.notification.findMany({ where: { userId: request.user.id, ...(anchor ? { createdAt: { gt: anchor.createdAt } } : {}) }, orderBy: { createdAt: 'desc' }, take: anchor ? 10 : 1 }),
    ])
    return response.json({ unreadCount, latest })
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
    if (request.user.role !== 'ADMIN') await notifyAdmins(prisma, { type: 'SYSTEM', title: `New support ticket · ${result.data.category.replaceAll('_', ' ').toLowerCase()}`, body: `${ticket.ticketNumber}: ${result.data.description}`, link: '/admin/support' }).catch(() => undefined)
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
    const supportLink = { CUSTOMER: '/account/support', RESTAURANT: '/restaurant/profile', RIDER: '/rider/account' }
    if (request.user.role === 'ADMIN') {
      const owner = ticket.userId !== request.user.id ? await prisma.user.findUnique({ where: { id: ticket.userId }, select: { id: true, role: true } }) : null
      if (owner) await notifyUsers(prisma, [owner.id], { type: 'SYSTEM', title: 'DOORSTEP support replied', body: `${ticket.ticketNumber}: ${result.data.body}`, link: supportLink[owner.role] || '/account/support' }).catch(() => undefined)
    } else {
      await notifyAdmins(prisma, { type: 'SYSTEM', title: `New reply on ${ticket.ticketNumber}`, body: result.data.body, link: '/admin/support' }).catch(() => undefined)
    }
    return response.status(201).json({ message })
  } catch { return response.status(503).json({ error: 'SUPPORT_SERVICE_UNAVAILABLE' }) }
})

app.get('/api/admin/applications/:type', requireUser, requireAdmin, async (request, response) => {
  if (!['restaurant', 'grocery', 'rider'].includes(request.params.type)) return response.status(400).json({ error: 'INVALID_APPLICATION_TYPE' })
  const query = z.object({
    status: z.enum(['OPEN', 'PENDING_APPROVAL', 'NEEDS_INFORMATION', 'APPROVED', 'REJECTED', 'SUSPENDED']).default('OPEN'),
    search: z.string().trim().max(100).optional(),
    city: z.string().trim().max(100).optional(),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
  }).safeParse(request.query)
  if (!query.success || (query.data.from && query.data.to && query.data.from > query.data.to)) return response.status(400).json({ error: 'INVALID_APPLICATION_FILTERS' })
  const statuses = query.data.status === 'OPEN' ? ['PENDING_APPROVAL', 'NEEDS_INFORMATION'] : [query.data.status]
  const submittedAt = {
    ...(query.data.from ? { gte: new Date(`${query.data.from}T00:00:00.000Z`) } : {}),
    ...(query.data.to ? { lte: new Date(`${query.data.to}T23:59:59.999Z`) } : {}),
  }
  const search = query.data.search
  const city = query.data.city
  try {
    const applications = request.params.type === 'rider'
      ? await prisma.riderApplication.findMany({ where: { status: { in: statuses }, ...(Object.keys(submittedAt).length ? { submittedAt } : {}), ...(search ? { OR: [{ rider: { user: { firstName: { contains: search, mode: 'insensitive' } } } }, { rider: { user: { lastName: { contains: search, mode: 'insensitive' } } } }, { rider: { user: { email: { contains: search, mode: 'insensitive' } } } }, { rider: { user: { phone: { contains: search, mode: 'insensitive' } } } }] } : {}), ...(city ? { preferredArea: { contains: city, mode: 'insensitive' } } : {}) }, include: { rider: { include: { user: { select: { id: true, email: true, phone: true, firstName: true, lastName: true } } } }, identityDocuments: { select: { id: true, type: true, verifiedAt: true } } }, orderBy: { submittedAt: 'asc' } })
      : await prisma.restaurantApplication.findMany({ where: { status: { in: statuses }, ...(Object.keys(submittedAt).length ? { submittedAt } : {}), restaurant: { storeType: request.params.type === 'grocery' ? 'GROCERY' : 'RESTAURANT', ...(city ? { city: { name: { contains: city, mode: 'insensitive' } } } : {}), ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }, { phone: { contains: search, mode: 'insensitive' } }, { application: { ownerName: { contains: search, mode: 'insensitive' } } }] } : {}) } }, include: { restaurant: { include: { city: { select: { name: true } } } }, documents: { select: { id: true, type: true, verifiedAt: true } } }, orderBy: { submittedAt: 'asc' } })
    return response.json({ applications })
  } catch { return response.status(503).json({ error: 'APPLICATION_SERVICE_UNAVAILABLE' }) }
})

app.get('/api/admin/applications/:type/:applicationId/documents/:documentId', requireUser, requireAdmin, async (request, response) => {
  if (!['restaurant', 'grocery', 'rider'].includes(request.params.type)) return response.status(400).json({ error: 'INVALID_APPLICATION_TYPE' })
  try {
    const document = request.params.type === 'rider'
      ? await prisma.riderIdentityDocument.findFirst({ where: { id: request.params.documentId, applicationId: request.params.applicationId } })
      : await prisma.restaurantDocument.findFirst({ where: { id: request.params.documentId, applicationId: request.params.applicationId, application: { is: { restaurant: { is: { storeType: request.params.type === 'grocery' ? 'GROCERY' : 'RESTAURANT' } } } } } })
    if (!document) return response.status(404).json({ error: 'APPLICATION_DOCUMENT_NOT_FOUND' })
    const file = await readPrivateDocument(document.storageKey)
    response.set('Cache-Control', 'private, no-store')
    response.set('X-Content-Type-Options', 'nosniff')
    response.set('Content-Type', file.mimeType)
    return response.send(file.buffer)
  } catch (error) {
    return response.status(error.status || 503).json({ error: error.code || 'APPLICATION_DOCUMENT_UNAVAILABLE' })
  }
})

app.get('/api/admin/summary', requireUser, requireAdmin, async (_request, response) => {
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  try {
    const [customers, restaurants, groceries, riders, ordersToday, activeDeliveries, pendingRestaurants, pendingGroceries, pendingRiders, sales] = await Promise.all([
      prisma.user.count({ where: { role: 'CUSTOMER' } }),
      prisma.restaurant.count({ where: { status: 'APPROVED', storeType: 'RESTAURANT' } }),
      prisma.restaurant.count({ where: { status: 'APPROVED', storeType: 'GROCERY' } }),
      prisma.rider.count({ where: { status: 'APPROVED' } }),
      prisma.order.count({ where: { createdAt: { gte: startOfDay } } }),
      prisma.delivery.count({ where: { status: { in: ['AVAILABLE', 'REQUESTED', 'ACCEPTED', 'GOING_TO_RESTAURANT', 'ARRIVED_AT_RESTAURANT', 'PICKED_UP', 'GOING_TO_CUSTOMER'] } } }),
      prisma.restaurantApplication.count({ where: { status: 'PENDING_APPROVAL', restaurant: { storeType: 'RESTAURANT' } } }),
      prisma.restaurantApplication.count({ where: { status: 'PENDING_APPROVAL', restaurant: { storeType: 'GROCERY' } } }),
      prisma.riderApplication.count({ where: { status: 'PENDING_APPROVAL' } }),
      prisma.order.aggregate({ where: { createdAt: { gte: startOfDay } }, _sum: { totalMinor: true } }),
    ])
    return response.json({ customers, restaurants, groceries, riders, ordersToday, activeDeliveries, pendingApprovals: pendingRestaurants + pendingGroceries + pendingRiders, grossSalesMinor: sales._sum.totalMinor || 0 })
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
  const result = z.object({ status: z.enum(['NEEDS_INFORMATION', 'APPROVED', 'REJECTED', 'SUSPENDED']), note: z.string().trim().max(1000).optional() }).superRefine((value, context) => {
    if (['NEEDS_INFORMATION', 'REJECTED'].includes(value.status) && !value.note) context.addIssue({ code: 'custom', path: ['note'], message: 'A note is required for this decision.' })
  }).safeParse(request.body)
  if (!result.success || !['restaurant', 'grocery', 'rider'].includes(request.params.type)) return response.status(400).json({ error: 'INVALID_APPLICATION_REVIEW' })
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
    const paymentSettings = await getPaymentSettings()
    if (result.data.paymentMethod === 'BANK_TRANSFER' && (!paymentSettings.bankTransfer.enabled || !hasValidBankTransferConfig(paymentSettings.bankTransfer))) return response.status(409).json({ error: 'BANK_TRANSFER_UNAVAILABLE' })
    if (result.data.paymentMethod === 'CASH_ON_DELIVERY') return response.status(409).json({ error: 'CASH_ON_DELIVERY_UNSUPPORTED' })
    if (result.data.paymentMethod === 'PAYSTACK' && !process.env.PAYSTACK_SECRET_KEY) return response.status(503).json({ error: 'PAYMENT_PROVIDER_NOT_CONFIGURED', message: 'Paystack is not configured. Choose another available payment method or contact support.' })
    const order = await prisma.$transaction(async (transaction) => {
      const orderNumber = `DSP-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomUUID().slice(0, 6).toUpperCase()}`
      const address = quote.address || await transaction.address.create({ data: { userId: request.user.id, cityId: quote.serviceAreaCityId, label: 'Checkout address', addressLine: result.data.addressLine, landmark: result.data.landmark, latitude: result.data.latitude, longitude: result.data.longitude } })
      const transferExpiry = result.data.paymentMethod === 'BANK_TRANSFER' && paymentSettings.bankTransfer.expiryMinutes ? new Date(Date.now() + paymentSettings.bankTransfer.expiryMinutes * 60_000) : null
      const transferInstructions = result.data.paymentMethod === 'BANK_TRANSFER' ? { bankName: paymentSettings.bankTransfer.bankName, accountName: paymentSettings.bankTransfer.accountName, accountNumber: paymentSettings.bankTransfer.accountNumber, message: paymentSettings.bankTransfer.instructions } : null
      const created = await transaction.order.create({ data: { orderNumber, idempotencyKey, customerId: request.user.id, restaurantId: quote.restaurantId, addressSnapshot: address.addressLine, landmarkSnapshot: result.data.landmark || address.landmark, latitude: address.latitude, longitude: address.longitude, subtotalMinor: quote.subtotalMinor, deliveryFeeMinor: quote.deliveryFeeMinor, serviceFeeMinor: quote.serviceFeeMinor, totalMinor: quote.totalMinor, items: { create: quote.items.map((item) => ({ menuItemId: item.menuItemId, nameSnapshot: item.name, unitPriceMinor: item.unitPriceMinor, quantity: item.quantity, instructions: item.instructions })) }, payment: { create: { provider: result.data.paymentMethod === 'PAYSTACK' ? 'paystack' : 'doorstep', method: result.data.paymentMethod, reference: result.data.paymentMethod === 'BANK_TRANSFER' ? `DSPTRF-${randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase()}` : `pending_${randomUUID()}`, amountMinor: quote.totalMinor, status: result.data.paymentMethod === 'BANK_TRANSFER' ? 'PENDING_VERIFICATION' : 'PENDING', verificationMethod: result.data.paymentMethod === 'BANK_TRANSFER' ? 'MANUAL' : null, expiresAt: transferExpiry, instructionsSnapshot: transferInstructions } } }, include: { items: true, payment: true } })
      if (created.payment.method === 'BANK_TRANSFER') await notifyAdmins(transaction, { type: 'PAYMENT', title: 'Bank transfer to confirm', body: `Order ${created.orderNumber} (${'₦'}${(created.totalMinor / 100).toLocaleString('en-NG')}) will be paid by bank transfer, reference ${created.payment.reference}. Confirm it once the money arrives.`, link: '/admin/payments' })
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
  const result = z.object({ orderId: z.string().min(1), saveCard: z.boolean().optional() }).safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_PAYMENT_REQUEST' })
  try {
    const order = await prisma.order.findFirst({ where: { id: result.data.orderId, customerId: request.user.id }, include: { payment: true } })
    if (!order || !order.payment) return response.status(404).json({ error: 'ORDER_PAYMENT_NOT_FOUND' })
    if (order.payment.method === 'BANK_TRANSFER') {
      if (order.payment.status !== 'PENDING_VERIFICATION') return response.status(409).json({ error: 'PAYMENT_NOT_PENDING_VERIFICATION' })
      if (order.payment.expiresAt && order.payment.expiresAt <= new Date()) {
        await prisma.payment.update({ where: { id: order.payment.id }, data: { status: 'EXPIRED' } })
        return response.status(409).json({ error: 'PAYMENT_EXPIRED' })
      }
      return response.json({ method: 'BANK_TRANSFER', orderId: order.id })
    }
    if (order.payment.method === 'CASH_ON_DELIVERY') return response.status(409).json({ error: 'CASH_ON_DELIVERY_NOT_SUPPORTED' })
    if (order.payment.status !== 'PENDING') return response.status(409).json({ error: 'PAYMENT_NOT_PENDING' })
    const payment = await initializePayment({ email: request.user.email, amountMinor: order.totalMinor, reference: order.payment.reference, callbackUrl: process.env.PAYMENT_CALLBACK_URL, metadata: { orderId: order.id, orderNumber: order.orderNumber, saveCard: Boolean(result.data.saveCard) } })
    return response.json(payment)
  } catch (error) {
    const paymentError = error instanceof PaymentError ? error : new PaymentError('PAYMENT_SERVICE_UNAVAILABLE', 'Payment service is unavailable.', 503)
    return response.status(paymentError.status).json({ error: paymentError.code, message: paymentError.message })
  }
})

app.get('/api/payments/orders/:orderId/bank-transfer', requireUser, async (request, response) => {
  try {
    const order = await prisma.order.findFirst({ where: { id: request.params.orderId, customerId: request.user.id }, include: { payment: true } })
    if (!order?.payment || order.payment.method !== 'BANK_TRANSFER') return response.status(404).json({ error: 'BANK_TRANSFER_NOT_FOUND' })
    if (order.payment.status === 'PENDING_VERIFICATION' && order.payment.expiresAt && order.payment.expiresAt <= new Date()) await prisma.payment.update({ where: { id: order.payment.id }, data: { status: 'EXPIRED' } })
    const payment = await prisma.payment.findUnique({ where: { id: order.payment.id } })
    return response.json({ orderNumber: order.orderNumber, amountMinor: order.totalMinor, currency: 'NGN', reference: payment.reference, status: payment.status, expiresAt: payment.expiresAt, instructions: payment.instructionsSnapshot })
  } catch {
    return response.status(503).json({ error: 'BANK_TRANSFER_SERVICE_UNAVAILABLE' })
  }
})

app.get('/api/admin/bank-transfers', requireUser, requireAdmin, async (request, response) => {
  const result = z.object({ status: z.enum(['PENDING_VERIFICATION', 'SUCCESSFUL', 'FAILED', 'EXPIRED', 'AMOUNT_MISMATCH']).optional() }).safeParse(request.query)
  if (!result.success) return response.status(400).json({ error: 'INVALID_BANK_TRANSFER_FILTER' })
  try {
    const payments = await prisma.payment.findMany({ where: { method: 'BANK_TRANSFER', ...(result.data.status ? { status: result.data.status } : {}) }, include: { order: { include: { customer: { select: { firstName: true, lastName: true, email: true } } } }, parcelBooking: { select: { id: true, reference: true, status: true, customer: { select: { firstName: true, lastName: true, email: true } } } }, transactions: { orderBy: { createdAt: 'desc' } } }, orderBy: { createdAt: 'desc' }, take: 100 })
    return response.json({ payments })
  } catch {
    return response.status(503).json({ error: 'BANK_TRANSFER_SERVICE_UNAVAILABLE' })
  }
})

app.post('/api/admin/bank-transfers/:paymentId/confirm', requireUser, requireAdmin, async (request, response) => {
  const result = z.object({ bankTransactionId: z.string().trim().min(3).max(160), note: z.string().trim().min(3).max(1000) }).safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_BANK_TRANSFER_CONFIRMATION', details: result.error.flatten() })
  try {
    const payment = await prisma.payment.findFirst({
      where: { id: request.params.paymentId, method: 'BANK_TRANSFER' },
      include: { order: true },
    })
    if (!payment) return response.status(404).json({ error: 'BANK_TRANSFER_NOT_FOUND' })
    if (payment.status !== 'PENDING_VERIFICATION') return response.status(409).json({ error: 'BANK_TRANSFER_NOT_PENDING_VERIFICATION' })
    if (payment.parcelBookingId) {
      await prisma.$transaction(async (transaction) => {
        await transaction.payment.update({ where: { id: payment.id }, data: { providerTransactionId: result.data.bankTransactionId } })
        await confirmParcelPayment(transaction, payment, { providerReference: result.data.bankTransactionId, source: 'admin_bank_transfer', metadata: { note: result.data.note, transferReference: payment.reference } })
        await transaction.auditLog.create({ data: { actorId: request.user.id, action: 'CONFIRM_BANK_TRANSFER', entityType: 'Payment', entityId: payment.id, metadata: { bankTransactionId: result.data.bankTransactionId, parcelBookingId: payment.parcelBookingId } } })
      })
      return response.json({ confirmed: true })
    }
    await prisma.$transaction(async (transaction) => {
      await transaction.payment.update({ where: { id: payment.id }, data: { status: 'SUCCESSFUL', verifiedAt: new Date(), providerTransactionId: result.data.bankTransactionId } })
      await transaction.order.update({ where: { id: payment.orderId }, data: { status: 'PAID', paidAt: new Date() } })
      await transaction.delivery.upsert({ where: { orderId: payment.orderId }, update: {}, create: { orderId: payment.orderId, status: 'AVAILABLE', requestedAt: new Date() } })
      await transaction.transaction.create({ data: { paymentId: payment.id, type: 'BANK_TRANSFER_MANUALLY_CONFIRMED', amountMinor: payment.amountMinor, providerReference: result.data.bankTransactionId, metadata: { note: result.data.note, transferReference: payment.reference } } })
      await transaction.auditLog.create({ data: { actorId: request.user.id, action: 'CONFIRM_BANK_TRANSFER', entityType: 'Payment', entityId: payment.id, metadata: { bankTransactionId: result.data.bankTransactionId, orderId: payment.orderId } } })
      await transaction.notification.create({ data: { userId: payment.order.customerId, type: 'PAYMENT', title: 'Bank transfer confirmed', body: `Your payment for ${payment.order.orderNumber} was confirmed. The restaurant will start on it shortly.`, link: `/account/orders/${payment.orderId}` } })
      await notifyUsers(transaction, await restaurantTeamIds(transaction, payment.order.restaurantId), { type: 'ORDER', title: 'New paid order', body: `Order ${payment.order.orderNumber} is paid and waiting for you to accept it.`, link: '/restaurant/orders' })
    })
    return response.json({ confirmed: true })
  } catch (error) {
    if (error.code === 'P2002') return response.status(409).json({ error: 'BANK_TRANSACTION_ALREADY_RECORDED' })
    return response.status(503).json({ error: 'BANK_TRANSFER_SERVICE_UNAVAILABLE' })
  }
})

// Confirms a verified food-order payment. Idempotent: a second confirmation is a no-op.
async function confirmOrderPayment(transaction, payment, { providerReference, metadata }) {
  const currentOrder = await transaction.order.findUnique({ where: { id: payment.orderId }, select: { status: true } })
  if (!currentOrder || !isOrderPayable(currentOrder.status)) throw Object.assign(new Error('Order is not payable in its current state.'), { code: 'ORDER_NOT_PAYABLE', status: 409 })
  const changed = await transaction.payment.updateMany({ where: { id: payment.id, status: { not: 'SUCCESSFUL' } }, data: { status: 'SUCCESSFUL', verifiedAt: new Date() } })
  if (changed.count !== 1) return { duplicate: true }
  const order = await transaction.order.update({ where: { id: payment.orderId }, data: { status: 'PAID', paidAt: new Date() }, include: { restaurant: { include: { users: true } } } })
  await transaction.delivery.upsert({ where: { orderId: payment.orderId }, update: {}, create: { orderId: payment.orderId, status: 'AVAILABLE', requestedAt: new Date() } })
  const commissionMinor = Math.round(order.subtotalMinor * 0.15)
  await transaction.commission.upsert({ where: { orderId: order.id }, update: {}, create: { orderId: order.id, percentage: 15, amountMinor: commissionMinor } })
  await transaction.restaurantPayout.upsert({ where: { orderId: order.id }, update: {}, create: { restaurantId: order.restaurantId, orderId: order.id, amountMinor: order.subtotalMinor - commissionMinor } })
  await transaction.notification.create({ data: { userId: order.customerId, type: 'PAYMENT', title: 'Payment confirmed', body: `Your payment for ${order.orderNumber} was confirmed. The restaurant will start on it shortly.`, link: `/account/orders/${order.id}` } })
  await notifyUsers(transaction, order.restaurant.users.map((member) => member.userId), { type: 'ORDER', title: 'New paid order', body: `Order ${order.orderNumber} is paid and waiting for you to accept it.`, link: '/restaurant/orders' })
  await transaction.transaction.create({ data: { paymentId: payment.id, type: 'PAYMENT_SUCCESS', amountMinor: payment.amountMinor, providerReference, metadata } })
  return { confirmed: true }
}

// Finds a payment by its current reference, or by a reference that was retired after a failed attempt.
async function findPaymentByReference(reference) {
  const current = await prisma.payment.findUnique({ where: { reference } })
  if (current) return { payment: current, expectedReference: reference }
  const rotated = await prisma.transaction.findFirst({ where: { type: 'PAYMENT_REFERENCE_ROTATED', providerReference: reference }, include: { payment: true } })
  return rotated?.payment ? { payment: rotated.payment, expectedReference: reference } : { payment: null, expectedReference: reference }
}

// Normalises a Paystack transaction (webhook payload or verify response) into one shape.
function paystackResult(data, status = data?.status) {
  return { status, reference: data?.reference, amount: data?.amount, currency: data?.currency, id: data?.id, gatewayResponse: data?.gateway_response || data?.gatewayResponse || null, paidAt: data?.paid_at || data?.paidAt || null, authorization: data?.authorization || null, channel: data?.channel || null, customerEmail: data?.customer?.email || data?.customerEmail || null, metadata: typeof data?.metadata === 'object' && data.metadata ? data.metadata : null }
}

async function paymentOwnerId(payment) {
  if (payment.parcelBookingId) return (await prisma.parcelBooking.findUnique({ where: { id: payment.parcelBookingId }, select: { customerId: true } }))?.customerId || null
  if (payment.orderId) return (await prisma.order.findUnique({ where: { id: payment.orderId }, select: { customerId: true } }))?.customerId || null
  return null
}

/**
 * Applies a provider-verified Paystack result to an order or parcel payment.
 * Used by the webhook, the callback verify endpoint and saved-card charges, so every path
 * reconciles reference, amount and currency the same way and confirms at most once.
 */
async function applyVerifiedPayment(payment, verified, source, expectedReference = payment.reference) {
  let outcome
  if (payment.parcelBookingId) {
    outcome = await applyPaystackVerification(prisma, payment, verified, source, { expectedReference })
  } else if (verified.status !== 'success') {
    if (verified.status === 'failed') await prisma.payment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { status: 'FAILED' } })
    outcome = { status: verified.status }
  } else if (!matchesPaystackPayment({ ...payment, reference: expectedReference }, { data: verified })) {
    await prisma.payment.updateMany({ where: { id: payment.id, status: { not: 'SUCCESSFUL' } }, data: { status: 'AMOUNT_MISMATCH' } })
    outcome = { status: 'mismatch' }
  } else {
    outcome = await prisma.$transaction((transaction) => confirmOrderPayment(transaction, payment, { providerReference: verified.reference, metadata: { source, gatewayResponse: verified.gatewayResponse, paidAt: verified.paidAt } }))
  }
  // Save the card only when the customer ticked "save this card" and Paystack marks it reusable.
  const wantsSave = verified.status === 'success' && (verified.metadata?.saveCard === true || verified.metadata?.saveCard === 'true')
  if (wantsSave && outcome?.status !== 'mismatch') {
    const ownerId = await paymentOwnerId(payment)
    if (ownerId) await saveCardFromAuthorization(prisma, ownerId, { authorization: verified.authorization, customerEmail: verified.customerEmail, channel: verified.channel }).catch((error) => console.error('[cards] save_failed', JSON.stringify({ code: error?.code })))
  }
  return outcome
}

app.post('/api/payments/webhook', async (request, response) => {
  if (!verifyWebhookSignature(request.rawBody, request.get('x-paystack-signature'))) return response.status(401).json({ error: 'INVALID_WEBHOOK_SIGNATURE' })
  const event = request.body
  if (event.event !== 'charge.success' || !event.data?.reference) return response.status(200).json({ received: true })
  try {
    const verified = paystackResult(event.data, 'success')
    const verification = await prisma.cardVerification.findUnique({ where: { reference: event.data.reference } })
    if (verification) {
      await completeCardVerification(prisma, verification, verified, 'webhook')
      return response.status(200).json({ received: true })
    }
    const { payment, expectedReference } = await findPaymentByReference(event.data.reference)
    if (!payment) return response.status(200).json({ received: true })
    if (!payment.parcelBookingId && payment.status === 'SUCCESSFUL') return response.status(200).json({ received: true, duplicate: true })
    const outcome = await applyVerifiedPayment(payment, verified, 'webhook', expectedReference)
    if (outcome?.status === 'mismatch') return response.status(400).json({ error: 'PAYMENT_RECONCILIATION_FAILED' })
    return response.status(200).json({ received: true, ...(outcome?.duplicate ? { duplicate: true } : {}) })
  } catch (error) {
    if (error?.code === 'ORDER_NOT_PAYABLE') return response.status(200).json({ received: true, notPayable: true })
    return response.status(503).json({ error: 'PAYMENT_WEBHOOK_RETRY' })
  }
})

// Called by the payment callback page. The browser only supplies a reference; the server asks Paystack.
app.post('/api/payments/verify', requireUser, rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false }), async (request, response) => {
  const result = z.object({ reference: z.string().trim().min(6).max(120) }).safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_PAYMENT_REFERENCE' })
  try {
    const verification = await prisma.cardVerification.findUnique({ where: { reference: result.data.reference } })
    if (verification) {
      if (verification.userId !== request.user.id) return response.status(404).json({ error: 'PAYMENT_NOT_FOUND' })
      const verified = await verifyPaystackTransaction(result.data.reference)
      const outcome = await completeCardVerification(prisma, verification, verified, 'verify')
      return response.json({ kind: 'card', status: outcome.status, providerStatus: verified.status, refundStatus: outcome.refundStatus || null })
    }
    const { payment, expectedReference } = await findPaymentByReference(result.data.reference)
    if (!payment) return response.status(404).json({ error: 'PAYMENT_NOT_FOUND' })
    const owner = payment.parcelBookingId
      ? await prisma.parcelBooking.findUnique({ where: { id: payment.parcelBookingId }, select: { id: true, customerId: true } })
      : await prisma.order.findUnique({ where: { id: payment.orderId }, select: { id: true, customerId: true } })
    if (!owner || owner.customerId !== request.user.id) return response.status(404).json({ error: 'PAYMENT_NOT_FOUND' })
    const target = payment.parcelBookingId ? { kind: 'parcel', id: owner.id } : { kind: 'order', id: owner.id }
    if (payment.status === 'SUCCESSFUL') return response.json({ ...target, status: 'SUCCESSFUL' })
    if (payment.method !== 'PAYSTACK') return response.json({ ...target, status: payment.status })
    const verified = await verifyPaystackTransaction(result.data.reference)
    const outcome = await applyVerifiedPayment(payment, verified, 'verify', expectedReference)
    if (outcome?.status === 'mismatch') return response.status(409).json({ ...target, error: 'PAYMENT_RECONCILIATION_FAILED' })
    const refreshed = await prisma.payment.findUnique({ where: { id: payment.id }, select: { status: true } })
    return response.json({ ...target, status: refreshed.status, providerStatus: verified.status, ...(outcome?.refundRequired ? { refundReview: true } : {}) })
  } catch (error) {
    const known = error instanceof PaymentError || error?.code === 'ORDER_NOT_PAYABLE' ? error : null
    if (!known) console.error('[payments] verify_failed', JSON.stringify({ name: error?.name, code: error?.code }))
    return response.status(known?.status || 503).json({ error: known?.code || 'PAYMENT_VERIFICATION_UNAVAILABLE' })
  }
})

app.use('/api', createCardRouter({ prisma, requireUser, applyVerifiedPayment, rotatePaymentReference }))

async function getRestaurantMembership(userId) {
  return prisma.restaurantUser.findFirst({ where: { userId }, select: { restaurantId: true, role: true } })
}

function canManageBusinessRiders(membership) {
  return membership && ['OWNER', 'MANAGER'].includes(membership.role)
}

app.get('/api/restaurant/riders', requireUser, async (request, response) => {
  if (request.user.role !== 'RESTAURANT') return response.status(403).json({ error: 'RESTAURANT_ROLE_REQUIRED' })
  try {
    const membership = await getRestaurantMembership(request.user.id)
    if (!canManageBusinessRiders(membership)) return response.status(403).json({ error: 'BUSINESS_RIDER_MANAGEMENT_REQUIRED' })
    const riders = await prisma.rider.findMany({
      where: { restaurantId: membership.restaurantId, network: 'BUSINESS_OWNED' },
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } } },
      orderBy: { user: { firstName: 'asc' } },
    })
    return response.json({ riders })
  } catch (error) {
    console.error('[restaurant-riders] list_failed', JSON.stringify({ name: error.name }))
    return response.status(503).json({ error: 'BUSINESS_RIDER_SERVICE_UNAVAILABLE' })
  }
})

app.patch('/api/restaurant/riders/:riderId', requireUser, async (request, response) => {
  if (request.user.role !== 'RESTAURANT') return response.status(403).json({ error: 'RESTAURANT_ROLE_REQUIRED' })
  const result = z.object({ assigned: z.boolean() }).safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_BUSINESS_RIDER_ASSIGNMENT' })
  try {
    const membership = await getRestaurantMembership(request.user.id)
    if (!canManageBusinessRiders(membership)) return response.status(403).json({ error: 'BUSINESS_RIDER_MANAGEMENT_REQUIRED' })
    const rider = await prisma.rider.findUnique({ where: { id: request.params.riderId }, select: { id: true, status: true, network: true, restaurantId: true } })
    if (!rider) return response.status(404).json({ error: 'RIDER_NOT_FOUND' })
    if (result.data.assigned) {
      if (rider.status !== 'APPROVED') return response.status(409).json({ error: 'RIDER_NOT_APPROVED' })
      if (rider.network === 'BUSINESS_OWNED' && rider.restaurantId !== membership.restaurantId) return response.status(409).json({ error: 'RIDER_ASSIGNED_TO_ANOTHER_BUSINESS' })
    } else if (rider.restaurantId !== membership.restaurantId || rider.network !== 'BUSINESS_OWNED') {
      return response.status(404).json({ error: 'BUSINESS_RIDER_NOT_FOUND' })
    }
    const updated = await prisma.rider.update({
      where: { id: rider.id },
      data: result.data.assigned ? { network: 'BUSINESS_OWNED', restaurantId: membership.restaurantId } : { network: 'DOORSTEP_POOL', restaurantId: null },
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } } },
    })
    await prisma.auditLog.create({
      data: {
        actorId: request.user.id,
        action: result.data.assigned ? 'ASSIGN_BUSINESS_RIDER' : 'REMOVE_BUSINESS_RIDER',
        entityType: 'Rider',
        entityId: rider.id,
        metadata: { restaurantId: membership.restaurantId },
      },
    })
    return response.json({ rider: updated })
  } catch (error) {
    console.error('[restaurant-riders] assignment_failed', JSON.stringify({ name: error.name }))
    return response.status(503).json({ error: 'BUSINESS_RIDER_SERVICE_UNAVAILABLE' })
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

export const restaurantProfileSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  phone: z.string().max(30).optional(),
  address: z.string().min(5).max(240),
  openingTime: z.union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), z.literal('')]).transform(value => value || null),
  closingTime: z.union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), z.literal('')]).transform(value => value || null),
  prepTimeMinutes: z.preprocess(value => value === '' || value === undefined ? null : Number(value), z.number().int().min(1).max(240).nullable()),
}).superRefine((value, context) => {
  if (Boolean(value.openingTime) !== Boolean(value.closingTime)) context.addIssue({ code: 'custom', path: ['openingTime'], message: 'Provide both opening and closing times.' })
})

app.patch('/api/restaurant/profile', requireUser, async (request, response) => {
  if (request.user.role !== 'RESTAURANT') return response.status(403).json({ error: 'RESTAURANT_ROLE_REQUIRED' })
  const result = restaurantProfileSchema.safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_RESTAURANT_PROFILE' })
  const membership = await prisma.restaurantUser.findFirst({ where: { userId: request.user.id }, select: { restaurantId: true } })
  if (!membership) return response.status(403).json({ error: 'RESTAURANT_ACCESS_REQUIRED' })
  try { return response.json({ restaurant: await prisma.restaurant.update({ where: { id: membership.restaurantId }, data: result.data }) }) } catch { return response.status(503).json({ error: 'RESTAURANT_PROFILE_SERVICE_UNAVAILABLE' }) }
})

registerPartnerMedia(app, { prisma, requireUser })

app.get('/api/restaurant/menu', requireUser, async (request, response) => {
  if (request.user.role !== 'RESTAURANT') return response.status(403).json({ error: 'RESTAURANT_ROLE_REQUIRED' })
  const membership = await prisma.restaurantUser.findFirst({ where: { userId: request.user.id }, select: { restaurantId: true } })
  if (!membership) return response.status(403).json({ error: 'RESTAURANT_ACCESS_REQUIRED' })
  try { const items = await prisma.menuItem.findMany({ where: { restaurantId: membership.restaurantId }, orderBy: { name: 'asc' } }); return response.json({ items: items.map(item => ({ ...item, imageUrl: menuMediaUrl(item) })) }) } catch { return response.status(503).json({ error: 'RESTAURANT_MENU_SERVICE_UNAVAILABLE' }) }
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
    const deliveries = await prisma.delivery.findMany({ where: { orderId: { not: null }, OR: [{ status: 'AVAILABLE' }, { riderId: request.user.rider.id, status: { notIn: ['DELIVERED', 'CANCELLED'] } }] }, include: { order: { include: { restaurant: { select: { name: true, address: true, phone: true } } } } }, orderBy: { requestedAt: 'asc' }, take: 50 })
    return response.json({ deliveries })
  } catch { return response.status(503).json({ error: 'RIDER_DELIVERY_SERVICE_UNAVAILABLE' }) }
})

app.get('/api/rider/profile', requireUser, async (request, response) => {
  if (request.user.role !== 'RIDER' || !request.user.rider) return response.status(403).json({ error: 'RIDER_ROLE_REQUIRED' })
  try {
    const rider = await prisma.rider.findUnique({
      where: { id: request.user.rider.id },
      select: { id: true, status: true, availability: true, vehicleType: true, vehicleDetails: true, network: true, ratingAverage: true, ratingCount: true, restaurant: { select: { name: true } } },
    })
    if (!rider) return response.status(404).json({ error: 'RIDER_PROFILE_NOT_FOUND' })
    return response.json({ rider })
  } catch {
    return response.status(503).json({ error: 'RIDER_PROFILE_SERVICE_UNAVAILABLE' })
  }
})

app.patch('/api/rider/availability', requireUser, async (request, response) => {
  const result = z.object({ availability: z.enum(['ONLINE', 'OFFLINE']) }).safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_AVAILABILITY' })
  if (request.user.role !== 'RIDER' || !request.user.rider) return response.status(403).json({ error: 'RIDER_ROLE_REQUIRED' })
  try {
    if (request.user.rider.status !== 'APPROVED' && result.data.availability === 'ONLINE') return response.status(403).json({ error: 'RIDER_NOT_APPROVED' })
    const rider = await prisma.rider.update({ where: { id: request.user.rider.id }, data: { availability: result.data.availability, ...(result.data.availability === 'OFFLINE' ? { availabilityLatitude: null, availabilityLongitude: null, availabilityAccuracyM: null, availabilityLocatedAt: null } : {}) } })
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
    deliveryRealtime.broadcastStatus(delivery.id, delivery.status)
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
    deliveryRealtime.broadcastStatus(delivery.id, delivery.status)
    return response.json({ delivery })
  } catch (error) {
    return response.status(error.status || 503).json({ error: error.code || 'DELIVERY_SERVICE_UNAVAILABLE', message: error.message })
  }
})

app.post('/api/deliveries/by-order/:orderNumber/status', requireUser, async (request, response) => {
  const result = z.object({ status: z.enum(['GOING_TO_RESTAURANT', 'ARRIVED_AT_RESTAURANT', 'PICKED_UP', 'GOING_TO_CUSTOMER', 'DELIVERED']) }).safeParse(request.body)
  if (!result.success) return response.status(400).json({ error: 'INVALID_DELIVERY_STATUS' })
  if (request.user.role !== 'RIDER' || !request.user.rider) return response.status(403).json({ error: 'RIDER_ROLE_REQUIRED' })
  try { const order = await prisma.order.findFirst({ where: { orderNumber: request.params.orderNumber, riderId: request.user.rider.id }, select: { delivery: { select: { id: true } } } }); if (!order?.delivery) return response.status(404).json({ error: 'DELIVERY_NOT_FOUND' }); const delivery = await advanceDelivery(order.delivery.id, request.user.rider.id, result.data.status); deliveryRealtime.broadcastStatus(delivery.id, delivery.status); return response.json({ delivery }) } catch (error) { return response.status(error.status || 503).json({ error: error.code || 'DELIVERY_SERVICE_UNAVAILABLE', message: error.message }) }
})

app.post('/api/deliveries/:deliveryId/location', requireUser, async (request, response) => {
  if (request.user.role !== 'RIDER' || !request.user.rider) return response.status(403).json({ error: 'RIDER_ROLE_REQUIRED' })
  try {
    const location = validateLocationUpdate(request.body)
    const saved = await recordLocation(request.params.deliveryId, request.user.rider.id, location)
    deliveryRealtime.broadcastLocation(request.params.deliveryId, saved)
    return response.status(202).json({ accepted: true, recordedAt: saved.recordedAt })
  } catch (error) {
    return response.status(error.status || 503).json({ error: error.code || 'LOCATION_SERVICE_UNAVAILABLE', message: error.message })
  }
})

app.get('/api/orders/:orderId/tracking', requireUser, async (request, response) => {
  try {
    const order = await prisma.order.findUnique({ where: { id: request.params.orderId }, include: { restaurant: { include: { users: { select: { userId: true } } } }, delivery: { include: { rider: { include: { user: true } } } }, payment: { select: { status: true } } } })
    if (!order) return response.status(404).json({ error: 'ORDER_NOT_FOUND' })
    if (request.user.role === 'CUSTOMER' && order.customerId !== request.user.id) return response.status(403).json({ error: 'ORDER_ACCESS_FORBIDDEN' })
    if (request.user.role === 'RIDER' && order.delivery?.riderId !== request.user.rider?.id) return response.status(403).json({ error: 'ORDER_ACCESS_FORBIDDEN' })
    const activeDelivery = order.delivery && ['ACCEPTED', 'GOING_TO_RESTAURANT', 'ARRIVED_AT_RESTAURANT', 'PICKED_UP', 'GOING_TO_CUSTOMER'].includes(order.delivery.status)
    if (!['CUSTOMER', 'RIDER', 'ADMIN'].includes(request.user.role) || (request.user.role === 'ADMIN' && !activeDelivery)) return response.status(403).json({ error: 'ORDER_ACCESS_FORBIDDEN' })
    const snapshot = order.delivery ? await getDeliveryTrackingSnapshot(order.delivery.id, request.user) : null
    const orderDetails = {
      id: order.id,
      orderNumber: order.orderNumber,
      restaurant: order.restaurant.name,
      status: order.status,
      delivery: order.delivery ? { id: order.delivery.id, status: order.delivery.status, location: snapshot?.delivery.location || null, rider: activeDelivery && order.delivery.rider ? { name: `${order.delivery.rider.user.firstName} ${order.delivery.rider.user.lastName}`, phone: order.delivery.rider.user.phone, callAllowed: Boolean(order.delivery.rider.user.phone) } : null } : null,
    }
    if (request.user.role === 'CUSTOMER') {
      orderDetails.totalMinor = order.totalMinor
      orderDetails.payment = order.payment ? { status: order.payment.status } : null
    }
    return response.json({ order: orderDetails })
  } catch (error) {
    return response.status(error.status || 503).json({ error: error.code || 'TRACKING_SERVICE_UNAVAILABLE' })
  }
})

app.get('/api/deliveries/:deliveryId/tracking', requireUser, async (request, response) => {
  try {
    return response.json(await getDeliveryTrackingSnapshot(request.params.deliveryId, request.user))
  } catch (error) {
    return response.status(error.status || 503).json({ error: error.code || 'TRACKING_SERVICE_UNAVAILABLE' })
  }
})

app.get('/api/admin/deliveries/active', requireUser, async (request, response) => {
  if (request.user.role !== 'ADMIN') return response.status(403).json({ error: 'ADMIN_ACCESS_REQUIRED' })
  try {
    const deliveries = await prisma.delivery.findMany({
      where: { status: { in: ['ACCEPTED', 'GOING_TO_RESTAURANT', 'ARRIVED_AT_RESTAURANT', 'PICKED_UP', 'GOING_TO_CUSTOMER'] } },
      include: { order: { select: { orderNumber: true, restaurant: { select: { name: true } } } }, parcelBooking: { select: { reference: true, pickupAddress: true } }, rider: { select: { user: { select: { firstName: true, lastName: true } } } } },
      orderBy: { acceptedAt: 'desc' },
    })
    const activeDeliveries = await Promise.all(deliveries.map(async (delivery) => {
      const snapshot = await getDeliveryTrackingSnapshot(delivery.id, request.user)
      return {
        id: delivery.id,
        status: delivery.status,
        kind: delivery.parcelBooking ? 'parcel' : 'order',
        orderNumber: delivery.order?.orderNumber || delivery.parcelBooking?.reference,
        restaurant: delivery.order?.restaurant.name || `Package pickup: ${delivery.parcelBooking?.pickupAddress || 'customer location'}`,
        rider: delivery.rider ? `${delivery.rider.user.firstName} ${delivery.rider.user.lastName}`.trim() : 'Awaiting rider',
        location: snapshot.delivery.location,
      }
    }))
    return response.json({ deliveries: activeDeliveries })
  } catch (error) {
    console.error('Could not load active delivery operations view', { code: error.code, name: error.name })
    return response.status(error.status || 503).json({ error: error.code || 'TRACKING_SERVICE_UNAVAILABLE' })
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
      await transaction.notification.create({ data: { userId: order.customerId, type: result.data.status === 'CANCELLED' ? 'ORDER' : 'DELIVERY', title: labels[result.data.status] || 'Order status updated', body: `Order ${order.orderNumber} is now ${result.data.status.replaceAll('_', ' ').toLowerCase()}.`, link: `/account/orders/${order.id}` } })
      if (result.data.status === 'READY_FOR_PICKUP' && !order.riderId) {
        // Let online riders know there is a pickup waiting.
        await notifyUsers(transaction, await availableRiderUserIds(transaction, { restaurantId: order.restaurantId }), { type: 'DELIVERY', title: 'New pickup nearby', body: `${order.restaurant.name} has order ${order.orderNumber} ready for collection.`, link: '/rider/deliveries' })
      }
      if (result.data.status === 'CANCELLED') {
        await notifyUsers(transaction, order.restaurant.users.map((member) => member.userId), { type: 'ORDER', title: 'Order cancelled', body: `DOORSTEP cancelled order ${order.orderNumber}. Stop preparing it.`, link: '/restaurant/orders' })
        if (order.riderId) {
          const rider = await transaction.rider.findUnique({ where: { id: order.riderId }, select: { userId: true } })
          if (rider) await notifyUsers(transaction, [rider.userId], { type: 'DELIVERY', title: 'Delivery cancelled', body: `Order ${order.orderNumber} was cancelled. You do not need to collect it.`, link: '/rider/dashboard' })
        }
      }
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
  if (subtotalMinor < restaurant.minimumOrderMinor) throw Object.assign(new Error('Order total is below this business’s minimum order.'), { status: 409, code: 'MINIMUM_ORDER_NOT_MET' })
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
  const server = app.listen(port, host, () => {
    console.log(`DOORSTEP API listening on http://${host}:${port}`)
  })
  deliveryRealtime.attach(server)
}
