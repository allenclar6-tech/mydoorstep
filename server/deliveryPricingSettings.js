import { z } from 'zod'
import { DELIVERY_PRICING_KEY, defaultDeliveryPricing } from './deliveryPricing.js'

// Admin-editable delivery pricing, stored in PlatformSetting under DELIVERY_PRICING_KEY.
const minor = z.number().int().min(0).max(10_000_000)
const id = z.string().trim().regex(/^[a-z0-9-]{1,40}$/)

const zone = z.object({
  id,
  name: z.string().trim().min(2).max(60),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  radiusMeters: z.number().int().min(100).max(10_000),
  customerSurchargeMinor: minor,
  riderBonusMinor: minor,
  // Fixed delivery price for every drop-off in this area (null = priced by distance). Needs no map pin.
  fixedFeeMinor: minor.nullable().default(null),
  // Remote / hard-to-reach area: adds the remote-area surcharge.
  remote: z.boolean().default(false),
  // Extra charge for difficult access to this area (bad road, river crossing, steep track).
  difficultAccessMinor: minor.default(0),
  active: z.boolean(),
}).strict().refine((value) => (value.latitude == null) === (value.longitude == null), { message: 'An area needs both latitude and longitude, or neither.' })

const routeRule = z.object({
  id,
  fromZoneId: id,
  toZoneId: id,
  bothWays: z.boolean(),
  customerFeeMinor: minor.nullable(),
  riderPayMinor: minor.nullable(),
  agreedWith: z.string().trim().max(80).default(''),
  note: z.string().trim().max(200).default(''),
  active: z.boolean(),
}).strict().refine((value) => value.customerFeeMinor != null || value.riderPayMinor != null, { message: 'An agreed price needs a customer fee, a rider amount, or both.' })

export const deliveryPricingSchema = z.object({
  published: z.boolean(),
  distance: z.object({
    detourFactor: z.number().min(1).max(3),
    maxRoadToStraightRatio: z.number().min(1.2).max(6),
    maxDeliveryKm: z.number().positive().max(100),
    assumedKm: z.number().positive().max(50),
  }).strict(),
  customerFee: z.object({
    baseMinor: minor,
    includedKm: z.number().min(0).max(50),
    perKmMinor: minor,
    minimumMinor: minor,
    maximumMinor: minor,
    roundToMinor: z.number().int().min(0).max(100_000),
  }).strict(),
  serviceFee: z.object({ percent: z.number().min(0).max(30), minimumMinor: minor, maximumMinor: minor }).strict(),
  margin: z.object({ protect: z.boolean(), minimumMinor: minor }).strict(),
  boost: z.object({ active: z.boolean(), label: z.string().trim().max(40), customerExtraMinor: minor, riderExtraMinor: minor }).strict(),
  zones: z.array(zone).max(80).default([]),
  // When on, checkout refuses addresses outside every approved delivery zone (Admin › Locations).
  coverage: z.object({ requireApprovedZone: z.boolean() }).strict().default({ requireApprovedZone: false }),
  routeRules: z.array(routeRule).max(200),
  surcharges: z.object({
    remoteMinor: minor,
    weekend: z.object({ active: z.boolean(), minor }).strict(),
    // Night deliveries (Lagos time; wraps midnight). riderMinor is added to the rider's pay.
    night: z.object({ active: z.boolean(), fromHour: z.number().int().min(0).max(23), toHour: z.number().int().min(0).max(23), minor, riderMinor: minor }).strict().default({ active: false, fromHour: 21, toHour: 6, minor: 0, riderMinor: 0 }),
  }).strict().default({ remoteMinor: 0, weekend: { active: false, minor: 0 }, night: { active: false, fromHour: 21, toHour: 6, minor: 0, riderMinor: 0 } }),
  // Rider waiting pay: minutes between “I've arrived” and delivery, after the free minutes. Paid by DOORSTEP.
  waiting: z.object({ enabled: z.boolean(), freeMinutes: z.number().int().min(0).max(120), perMinuteMinor: minor, maxMinor: minor }).strict().default({ enabled: false, freeMinutes: 10, perMinuteMinor: 2_000, maxMinor: 30_000 }),
  // Demand-based pricing (surge). OFF by default; only a Super admin (the platform owner) may change it.
  demand: z.object({
    enabled: z.boolean(),
    triggerRatio: z.number().min(1).max(20),
    stepPercent: z.number().min(1).max(50),
    maxPercent: z.number().min(0).max(100),
    maxExtraMinor: minor,
    riderSharePercent: z.number().min(0).max(100),
    zoneIds: z.array(id).max(80),
  }).strict().default({ enabled: false, triggerRatio: 3, stepPercent: 10, maxPercent: 30, maxExtraMinor: 50_000, riderSharePercent: 100, zoneIds: [] }),
  freeDelivery: z.object({ active: z.boolean(), thresholdMinor: minor }).strict().default({ active: false, thresholdMinor: 0 }),
  // DISTANCE_FIRST: agreed route prices, else the measured kilometres whenever they're reliable, and a fixed area
  // price only when they aren't. AREA_FIRST / ROUTE_FIRST: fixed prices always win (which one first when both exist).
  precedence: z.enum(['DISTANCE_FIRST', 'AREA_FIRST', 'ROUTE_FIRST']).default('DISTANCE_FIRST'),
  // Manual delivery quotes: when the location or distance isn't reliable, DOORSTEP confirms the fee before payment.
  manualQuotes: z.object({
    enabled: z.boolean(),
    minConfidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
    // Charge automatically when both the store and the customer dropped exact pins, even if road routing is down.
    autoPriceExactPins: z.boolean().default(true),
    quoteBeyondMaxDistance: z.boolean(),
    maxAutoFeeMinor: minor.nullable(),
    expiryHours: z.number().int().min(1).max(168),
    maxRounds: z.number().int().min(0).max(10),
    maxQuoteMinor: minor,
  }).strict().default({ enabled: true, minConfidence: 'MEDIUM', autoPriceExactPins: true, quoteBeyondMaxDistance: true, maxAutoFeeMinor: null, expiryHours: 24, maxRounds: 3, maxQuoteMinor: 2_000_000 }),
}).strict().superRefine((value, context) => {
  const zoneIds = new Set()
  for (const [index, entry] of value.zones.entries()) {
    if (zoneIds.has(entry.id)) context.addIssue({ code: 'custom', path: ['zones', index, 'id'], message: `Two areas share the id ${entry.id}.` })
    zoneIds.add(entry.id)
  }
  const ruleIds = new Set()
  for (const [index, rule] of value.routeRules.entries()) {
    if (ruleIds.has(rule.id)) context.addIssue({ code: 'custom', path: ['routeRules', index, 'id'], message: 'Two agreed prices share an id.' })
    ruleIds.add(rule.id)
    if (!zoneIds.has(rule.fromZoneId) || !zoneIds.has(rule.toZoneId)) context.addIssue({ code: 'custom', path: ['routeRules', index], message: 'An agreed price points at an area that no longer exists.' })
  }
  if (value.customerFee.maximumMinor < value.customerFee.minimumMinor) context.addIssue({ code: 'custom', path: ['customerFee', 'maximumMinor'], message: 'The maximum fee must be at least the minimum fee.' })
  if (value.serviceFee.maximumMinor < value.serviceFee.minimumMinor) context.addIssue({ code: 'custom', path: ['serviceFee', 'maximumMinor'], message: 'The maximum service fee must be at least the minimum.' })
})

export async function getDeliveryPricing(db) {
  const stored = await db.platformSetting.findUnique({ where: { key: DELIVERY_PRICING_KEY } })
  if (!stored) return { ...structuredClone(defaultDeliveryPricing), starter: true }
  const parsed = deliveryPricingSchema.safeParse(stored.value)
  if (!parsed.success) {
    console.error('[delivery-pricing] stored settings are invalid; every delivery waits for a confirmed price until fixed')
    return { ...structuredClone(defaultDeliveryPricing), published: false, invalidStoredSettings: true }
  }
  return parsed.data
}

export async function saveDeliveryPricing(db, value) {
  const parsed = deliveryPricingSchema.parse(value)
  await db.platformSetting.upsert({ where: { key: DELIVERY_PRICING_KEY }, update: { value: parsed }, create: { key: DELIVERY_PRICING_KEY, value: parsed } })
  return parsed
}
