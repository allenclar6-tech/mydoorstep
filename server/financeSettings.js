import { z } from 'zod'
import { defaultFinanceSettings } from './financeService.js'

// Admin-editable finance settings, stored in PlatformSetting under FINANCE_SETTINGS_KEY.
export const FINANCE_SETTINGS_KEY = 'finance_settings'

const band = z.object({ upToKm: z.number().positive().max(100), amountMinor: z.number().int().min(0).max(10_000_000) })
export const financeSettingsSchema = z.object({
  commission: z.object({
    doorstepRiderPercent: z.number().min(0).max(50),
    ownRiderPercent: z.number().min(0).max(50),
  }),
  riderPay: z.object({
    enabled: z.boolean(),
    // Sorted distance bands: a delivery of d km earns the first band with d ≤ upToKm.
    bands: z.array(band).max(30),
    perKmAfterMinor: z.number().int().min(0).max(1_000_000).default(0),
    note: z.string().max(300).optional(),
  }).superRefine((value, context) => {
    const sorted = [...value.bands].sort((a, b) => a.upToKm - b.upToKm)
    if (sorted.some((entry, index) => index > 0 && entry.upToKm === sorted[index - 1].upToKm)) context.addIssue({ code: 'custom', path: ['bands'], message: 'Each distance band needs a different upper limit.' })
    if (value.enabled && !value.bands.length) context.addIssue({ code: 'custom', path: ['bands'], message: 'Add at least one distance band before switching rider pay on.' })
  }),
  split: z.object({
    enabled: z.boolean(),
    // Who pays Paystack's processing fee on split payments: 'account' = DOORSTEP, 'all-proportional' = shared by share size.
    feeBearer: z.enum(['account', 'all-proportional']),
  }),
  // DOORSTEP's service fee on each completed delivery, as a percentage of the rider's earning (Glovo-style).
  // Settings saved before this existed get the default.
  riderFee: z.object({ percent: z.number().min(0).max(30) }).default({ percent: 6 }),
})

export async function getFinanceSettings(db) {
  const stored = await db.platformSetting.findUnique({ where: { key: FINANCE_SETTINGS_KEY } })
  if (!stored) return structuredClone(defaultFinanceSettings)
  const parsed = financeSettingsSchema.safeParse(stored.value)
  if (!parsed.success) {
    console.error('[finance] stored settings are invalid; using safe defaults with rider pay off')
    return { ...structuredClone(defaultFinanceSettings), invalidStoredSettings: true }
  }
  return { ...parsed.data, riderPay: { ...parsed.data.riderPay, bands: [...parsed.data.riderPay.bands].sort((a, b) => a.upToKm - b.upToKm) } }
}

