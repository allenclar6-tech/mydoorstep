import express from 'express'
import { z } from 'zod'
import { distanceTable, isPoint, measureDelivery, priceDelivery, STARTER_RIDER_BANDS, STARTER_RIDER_PER_KM_AFTER_MINOR, WARNING_TEXT } from './deliveryPricing.js'
import { cachedRoutes, resolveCalculatorPoint } from './deliveryQuote.js'
import { deliveryBlockers, deliveryZones } from './locations.js'
import { deliveryPricingSchema, getDeliveryPricing, saveDeliveryPricing } from './deliveryPricingSettings.js'
import { FINANCE_SETTINGS_KEY, financeSettingsSchema, getFinanceSettings } from './financeSettings.js'
import { routingConfigured } from './parcelService.js'

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
      const zones = await deliveryZones(prisma)
      response.set('Cache-Control', 'public, max-age=120')
      return response.json({ published: pricing.published, requireApprovedZone: Boolean(pricing.coverage?.requireApprovedZone), areas: zones.map((zone) => ({ id: zone.id, name: zone.name, closed: zone.closed, closedReason: zone.closedReason || null, minimumOrderMinor: zone.minimumOrderMinor ?? null })) })
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
    try {
      // Agreed route prices must point at real directory locations.
      if (parsed.data.routeRules.length) {
        const slugs = new Set((await prisma.location.findMany({ where: { mergedIntoId: null }, select: { slug: true } })).map((row) => row.slug))
        const missing = parsed.data.routeRules.find((rule) => !slugs.has(rule.fromZoneId) || !slugs.has(rule.toZoneId))
        if (missing) return response.status(400).json({ error: 'INVALID_DELIVERY_PRICING', message: 'An agreed price points at a location that no longer exists (or was merged). Pick the areas again.' })
      }
      const previous = await getDeliveryPricing(prisma)
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

  // Calculator: measures a real route between two points and prices it with the saved or draft settings.
  router.post('/admin/delivery-pricing/calculate', requireUser, requireAdmin, async (request, response) => {
    const parsed = calculateSchema.safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_CALCULATION', message: parsed.error.issues[0]?.message })
    try {
      const [savedPricing, savedFinance] = await Promise.all([getDeliveryPricing(prisma), getFinanceSettings(prisma)])
      const { pricing, finance } = draftSettings(parsed.data.draft, savedPricing, savedFinance)
      const [zones, allLocations] = await Promise.all([deliveryZones(prisma), prisma.location.findMany({ where: { mergedIntoId: null }, select: { slug: true, name: true, latitude: true, longitude: true } })])
      const pickup = await resolveCalculatorPoint(prisma, parsed.data.pickup, zones, { allLocations })
      const dropoff = await resolveCalculatorPoint(prisma, parsed.data.dropoff, zones, { allLocations })
      const distance = await measureDelivery(pickup.point, dropoff.point, pricing.distance, routingConfigured() ? cachedRoutes(fetchImpl) : null)
      const fulfilment = parsed.data.fulfilment || pickup.fulfilment || 'DOORSTEP_RIDER'
      const quote = priceDelivery({ distance, pickupZone: pickup.zone, dropoffZone: dropoff.zone, subtotalMinor: parsed.data.subtotalMinor, fulfilment, pricing, finance })
      return response.json({ quote, pickup: { label: pickup.label, point: pickup.point, zone: pickup.zone }, dropoff: { label: dropoff.label, point: dropoff.point, zone: dropoff.zone }, table: distanceTable({ pricing, finance, subtotalMinor: parsed.data.subtotalMinor, fulfilment }) })
    } catch (error) { return fail(response, error) }
  })

  return router
}
