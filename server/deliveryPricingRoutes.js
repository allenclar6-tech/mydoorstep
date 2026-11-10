import express from 'express'
import { z } from 'zod'
import { distanceTable, isPoint, measureDelivery, priceDelivery, STARTER_RIDER_BANDS, STARTER_RIDER_PER_KM_AFTER_MINOR, WARNING_TEXT } from './deliveryPricing.js'
import { cachedRoutes, pricingZones, resolveCalculatorPoint } from './deliveryQuote.js'
import { deliveryBlockers, deliveryZones } from './locations.js'
import { deliveryPricingSchema, getDeliveryPricing, saveDeliveryPricing } from './deliveryPricingSettings.js'
import { FINANCE_SETTINGS_KEY, financeSettingsSchema, getFinanceSettings } from './financeSettings.js'
import { routingConfigured, routingStatus } from './parcelService.js'
import { isOwner } from './staff.js'

// Pricing changes can be scheduled: saved now, switched on automatically at activatesAt (checked every minute).
export const SCHEDULED_PRICING_KEY = 'delivery_pricing_scheduled'

/** Switches on a scheduled pricing change once its time has come. Safe to run from several places at once. */
export async function activateScheduledPricing(db, now = new Date()) {
  const scheduled = await db.platformSetting.findUnique({ where: { key: SCHEDULED_PRICING_KEY } })
  if (!scheduled || new Date(scheduled.value?.activatesAt) > now) return null
  return db.$transaction(async (tx) => {
    // Whoever deletes the scheduled row applies it; a second runner finds nothing to delete and stops.
    const claimed = await tx.platformSetting.deleteMany({ where: { key: SCHEDULED_PRICING_KEY } })
    if (claimed.count !== 1) return null
    const value = await saveDeliveryPricing(tx, scheduled.value.pricing)
    if (scheduled.value.riderPay) {
      const finance = await getFinanceSettings(tx)
      const { invalidStoredSettings, ...rest } = finance
      const next = financeSettingsSchema.parse({ ...rest, riderPay: scheduled.value.riderPay })
      await tx.platformSetting.upsert({ where: { key: FINANCE_SETTINGS_KEY }, update: { value: next }, create: { key: FINANCE_SETTINGS_KEY, value: next } })
    }
    await tx.auditLog.create({ data: { actorId: scheduled.value.by || null, action: 'DELIVERY_PRICING_ACTIVATED', entityType: 'PlatformSetting', entityId: 'delivery_pricing', metadata: { scheduledFor: scheduled.value.activatesAt, activatedAt: now.toISOString() } } })
    return value
  })
}

const point = z.object({ restaurantId: z.string().min(1).max(60).optional(), zoneId: z.string().min(1).max(40).optional(), latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional(), label: z.string().max(120).optional() })
const calculateSchema = z.object({
  pickup: point,
  dropoff: point,
  subtotalMinor: z.number().int().min(0).max(100_000_000).default(0),
  fulfilment: z.enum(['DOORSTEP_RIDER', 'BUSINESS_RIDER']).optional(),
  draft: z.object({ pricing: z.unknown().optional(), riderPay: z.unknown().optional() }).optional(),
})

// Flags the server adds when reading settings (never part of what is saved).
const withoutFlags = (value) => { if (!value || typeof value !== 'object') return value; const { starter, invalidStoredSettings, ...rest } = value; return rest }

const fail = (response, error) => {
  if (error?.status && error?.code) return response.status(error.status).json({ error: error.code, message: error.message })
  console.error('[delivery-pricing]', error?.message)
  return response.status(503).json({ error: 'DELIVERY_PRICING_UNAVAILABLE', message: 'Delivery pricing is temporarily unavailable.' })
}

/** Draft settings typed into the admin page, validated so the calculator can preview them before saving. */
function draftSettings(draft, pricing, finance) {
  let draftPricing = pricing
  let draftFinance = finance
  if (draft?.pricing) {
    const parsed = deliveryPricingSchema.safeParse(withoutFlags(draft.pricing))
    if (!parsed.success) throw Object.assign(new Error(parsed.error.issues[0]?.message || 'Check the pricing values.'), { status: 400, code: 'INVALID_DELIVERY_PRICING' })
    draftPricing = parsed.data
  }
  if (draft?.riderPay) {
    const parsed = financeSettingsSchema.shape.riderPay.safeParse(draft.riderPay)
    if (!parsed.success) throw Object.assign(new Error(parsed.error.issues[0]?.message || 'Check the rider rates.'), { status: 400, code: 'INVALID_RIDER_RATES' })
    draftFinance = { ...finance, riderPay: { ...parsed.data, bands: [...parsed.data.bands].sort((a, b) => a.upToKm - b.upToKm) } }
  }
  return { pricing: draftPricing, finance: draftFinance }
}

export function createDeliveryPricingRouter({ prisma, requireUser, requireAdmin, fetchImpl }) {
  const router = express.Router()

  // Public: placed Sapele areas, so customers can pick an area and still get a fair distance-based price.
  router.get('/delivery/areas', async (_request, response) => {
    try {
      const pricing = await getDeliveryPricing(prisma)
      const located = await deliveryZones(prisma)
      response.set('Cache-Control', 'public, max-age=120')
      const placed = pricing.zones.filter((zone) => zone.active).map((zone) => ({ id: zone.id, name: zone.name, placed: isPoint(zone), latitude: zone.latitude, longitude: zone.longitude, closed: false }))
      const approved = located.map((zone) => ({ id: zone.id, name: zone.name, placed: true, latitude: zone.latitude, longitude: zone.longitude, closed: zone.closed, closedReason: zone.closedReason || null, minimumOrderMinor: zone.minimumOrderMinor ?? null }))
      return response.json({ published: pricing.published, requireApprovedZone: Boolean(pricing.coverage?.requireApprovedZone), areas: [...placed, ...approved] })
    } catch (error) { return fail(response, error) }
  })

  router.get('/admin/delivery-pricing', requireUser, requireAdmin, async (_request, response) => {
    try {
      const [pricing, finance, restaurants, locations] = await Promise.all([
        getDeliveryPricing(prisma),
        getFinanceSettings(prisma),
        prisma.restaurant.findMany({ where: { status: 'APPROVED' }, select: { id: true, name: true, latitude: true, longitude: true, application: { select: { deliveryPreference: true } } }, orderBy: { name: 'asc' }, take: 500 }),
        prisma.location.findMany({ where: { mergedIntoId: null, NOT: { verificationStatus: 'rejected' } }, orderBy: { name: 'asc' }, take: 2000 }),
      ])
      return response.json({
        pricing,
        finance: { commission: finance.commission, riderPay: finance.riderPay },
        businesses: restaurants.map((restaurant) => ({ id: restaurant.id, name: restaurant.name, pinned: isPoint(restaurant), ownRiders: restaurant.application?.deliveryPreference === 'OWN_RIDERS' })),
        routingConfigured: routingConfigured(),
        routing: routingStatus(),
        scheduled: await prisma.platformSetting.findUnique({ where: { key: SCHEDULED_PRICING_KEY } }).then((row) => row ? { activatesAt: row.value.activatesAt, by: row.value.byName || null, savedAt: row.value.savedAt } : null),
        starterRiderPay: { bands: STARTER_RIDER_BANDS, perKmAfterMinor: STARTER_RIDER_PER_KM_AFTER_MINOR },
        warningText: WARNING_TEXT,
        locations: locations.map((row) => ({ id: row.slug, locationId: row.id, name: row.name, status: row.verificationStatus, placed: isPoint(row), zone: deliveryBlockers(row).length === 0, closed: Boolean(row.closedUntil && new Date(row.closedUntil) > new Date()), surchargeMinor: row.customerSurchargeMinor, bonusMinor: row.riderBonusMinor })),
      })
    } catch (error) { return fail(response, error) }
  })

  // Saves delivery pricing and (optionally) the rider rate card together, so the two are always balanced.
  router.put('/admin/delivery-pricing', requireUser, requireAdmin, async (request, response) => {
    const parsed = deliveryPricingSchema.safeParse(withoutFlags(request.body?.pricing))
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_DELIVERY_PRICING', message: parsed.error.issues[0]?.message, path: parsed.error.issues[0]?.path })
    let riderPay = null
    if (request.body?.riderPay) {
      const riderParsed = financeSettingsSchema.shape.riderPay.safeParse(request.body.riderPay)
      if (!riderParsed.success) return response.status(400).json({ error: 'INVALID_RIDER_RATES', message: riderParsed.error.issues[0]?.message })
      riderPay = { ...riderParsed.data, bands: [...riderParsed.data.bands].sort((a, b) => a.upToKm - b.upToKm) }
    }
    if (parsed.data.published && !(riderPay || (await getFinanceSettings(prisma)).riderPay).enabled) {
      return response.status(409).json({ error: 'RIDER_RATES_REQUIRED', message: 'Switch on rider rates before publishing delivery pricing, so every delivery has a rider amount and a margin check.' })
    }
    // Demand-based pricing is the platform owner's decision only (it's off at launch).
    const current = await getDeliveryPricing(prisma)
    if (JSON.stringify(current.demand) !== JSON.stringify(parsed.data.demand) && !isOwner(request.user)) return response.status(403).json({ error: 'OWNER_ONLY', message: 'Only a Super admin (the platform owner) can change demand-based pricing.' })
    // Scheduled change: kept aside and switched on automatically at activatesAt.
    const activatesAt = request.body?.activatesAt ? new Date(request.body.activatesAt) : null
    if (activatesAt) {
      if (Number.isNaN(activatesAt.getTime()) || activatesAt < new Date(Date.now() + 60_000) || activatesAt > new Date(Date.now() + 90 * 86_400_000)) return response.status(400).json({ error: 'INVALID_ACTIVATION_TIME', message: 'Pick a time at least a minute from now and within 90 days.' })
      try {
        const value = { pricing: parsed.data, riderPay, activatesAt: activatesAt.toISOString(), by: request.user.id, byName: `${request.user.firstName || ''} ${request.user.lastName || ''}`.trim(), savedAt: new Date().toISOString() }
        await prisma.$transaction([
          prisma.platformSetting.upsert({ where: { key: SCHEDULED_PRICING_KEY }, update: { value }, create: { key: SCHEDULED_PRICING_KEY, value } }),
          prisma.auditLog.create({ data: { actorId: request.user.id, action: 'DELIVERY_PRICING_SCHEDULED', entityType: 'PlatformSetting', entityId: 'delivery_pricing', metadata: { activatesAt: value.activatesAt, published: parsed.data.published } } }),
        ])
        return response.json({ scheduled: { activatesAt: value.activatesAt, by: value.byName, savedAt: value.savedAt } })
      } catch (error) { return fail(response, error) }
    }
    try {
      const previous = current
      const saved = await prisma.$transaction(async (transaction) => {
        const value = await saveDeliveryPricing(transaction, parsed.data)
        if (riderPay) {
          const finance = await getFinanceSettings(transaction)
          const { invalidStoredSettings, ...rest } = finance
          const next = financeSettingsSchema.parse({ ...rest, riderPay })
          await transaction.platformSetting.upsert({ where: { key: FINANCE_SETTINGS_KEY }, update: { value: next }, create: { key: FINANCE_SETTINGS_KEY, value: next } })
        }
        await transaction.auditLog.create({ data: { actorId: request.user.id, action: previous.published !== value.published ? (value.published ? 'DELIVERY_PRICING_PUBLISHED' : 'DELIVERY_PRICING_UNPUBLISHED') : 'DELIVERY_PRICING_UPDATED', entityType: 'PlatformSetting', entityId: 'delivery_pricing', metadata: { customerFee: value.customerFee, margin: value.margin, boost: value.boost, zones: value.zones.length, routeRules: value.routeRules.length, riderPay } } })
        return value
      })
      const finance = await getFinanceSettings(prisma)
      return response.json({ pricing: saved, finance: { commission: finance.commission, riderPay: finance.riderPay } })
    } catch (error) { return fail(response, error) }
  })

  router.delete('/admin/delivery-pricing/scheduled', requireUser, requireAdmin, async (request, response) => {
    try {
      const removed = await prisma.platformSetting.deleteMany({ where: { key: SCHEDULED_PRICING_KEY } })
      if (removed.count) await prisma.auditLog.create({ data: { actorId: request.user.id, action: 'DELIVERY_PRICING_SCHEDULE_CANCELLED', entityType: 'PlatformSetting', entityId: 'delivery_pricing', metadata: {} } })
      return response.json({ cancelled: removed.count > 0 })
    } catch (error) { return fail(response, error) }
  })

  // Calculator: measures a real route between two points and prices it with the saved or draft settings.
  router.post('/admin/delivery-pricing/calculate', requireUser, requireAdmin, async (request, response) => {
    const parsed = calculateSchema.safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_CALCULATION', message: parsed.error.issues[0]?.message })
    try {
      const [savedPricing, savedFinance] = await Promise.all([getDeliveryPricing(prisma), getFinanceSettings(prisma)])
      const { pricing, finance } = draftSettings(parsed.data.draft, savedPricing, savedFinance)
      const zones = await pricingZones(prisma, pricing)
      const pickup = await resolveCalculatorPoint(prisma, parsed.data.pickup, zones)
      const dropoff = await resolveCalculatorPoint(prisma, parsed.data.dropoff, zones)
      const distance = await measureDelivery(pickup.point, dropoff.point, pricing.distance, routingConfigured() ? cachedRoutes(fetchImpl) : null)
      const fulfilment = parsed.data.fulfilment || pickup.fulfilment || 'DOORSTEP_RIDER'
      const quote = priceDelivery({ distance, pickupZone: pickup.zone, dropoffZone: dropoff.zone, subtotalMinor: parsed.data.subtotalMinor, fulfilment, pricing, finance })
      return response.json({ quote, pickup: { label: pickup.label, point: pickup.point, zone: pickup.zone }, dropoff: { label: dropoff.label, point: dropoff.point, zone: dropoff.zone }, table: distanceTable({ pricing, finance, subtotalMinor: parsed.data.subtotalMinor, fulfilment }) })
    } catch (error) { return fail(response, error) }
  })

  return router
}
