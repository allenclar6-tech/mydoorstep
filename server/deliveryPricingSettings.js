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
  zones: z.array(zone).max(80),
  routeRules: z.array(routeRule).max(200),
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
    console.error('[delivery-pricing] stored settings are invalid; checkout falls back to the old flat fee until fixed')
    return { ...structuredClone(defaultDeliveryPricing), published: false, invalidStoredSettings: true }
  }
  return parsed.data
}

export async function saveDeliveryPricing(db, value) {
  const parsed = deliveryPricingSchema.parse(value)
  await db.platformSetting.upsert({ where: { key: DELIVERY_PRICING_KEY }, update: { value: parsed }, create: { key: DELIVERY_PRICING_KEY, value: parsed } })
  return parsed
}
