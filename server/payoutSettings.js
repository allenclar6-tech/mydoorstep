import { z } from 'zod'

// How and when businesses and riders are paid (Glovo-style): by an admin, automatically once an order is
// delivered, or on a daily/weekly schedule, plus self-service cash-outs. Stored apart from the finance settings
// so saving commission rates never resets payout choices.
export const PAYOUT_SETTINGS_KEY = 'payout_settings'
export const PAYOUT_SCHEDULE_STATE_KEY = 'payout_schedule_state'
// Sapele runs on West Africa Time (UTC+1, no daylight saving).
export const LAGOS_OFFSET_MS = 60 * 60_000

const rule = z.object({
  // MANUAL: an admin pays from Admin → Money. AUTOMATIC: paid as soon as money clears. SCHEDULED: paid on a timetable.
  mode: z.enum(['MANUAL', 'AUTOMATIC', 'SCHEDULED']),
  frequency: z.enum(['DAILY', 'WEEKLY']),
  weekday: z.number().int().min(0).max(6), // 0 = Sunday, Lagos time
  hour: z.number().int().min(0).max(23), // Lagos time
  // Money clears this many hours after it is earned (and, for orders, only once the order is delivered),
  // leaving time for complaints and refunds before it leaves DOORSTEP.
  holdHours: z.number().int().min(0).max(336),
  minimumMinor: z.number().int().min(100).max(100_000_000),
})

export const payoutSettingsSchema = z.object({
  businesses: rule,
  riders: rule,
  withdrawals: z.object({
    enabled: z.boolean(),
    minimumMinor: z.number().int().min(100).max(100_000_000),
    feeMinor: z.number().int().min(0).max(1_000_000),
    feePercent: z.number().min(0).max(10),
    perDay: z.number().int().min(1).max(10),
  }),
})

export const defaultPayoutSettings = Object.freeze({
  businesses: { mode: 'MANUAL', frequency: 'WEEKLY', weekday: 1, hour: 10, holdHours: 24, minimumMinor: 100_000 },
  riders: { mode: 'MANUAL', frequency: 'WEEKLY', weekday: 1, hour: 10, holdHours: 0, minimumMinor: 50_000 },
  withdrawals: { enabled: false, minimumMinor: 100_000, feeMinor: 10_000, feePercent: 0, perDay: 3 },
})

export const ruleFor = (settings, party) => party === 'RIDER' ? settings.riders : settings.businesses

export async function getPayoutSettings(db) {
  const stored = await db.platformSetting.findUnique({ where: { key: PAYOUT_SETTINGS_KEY } })
  if (!stored) return structuredClone(defaultPayoutSettings)
  const parsed = payoutSettingsSchema.safeParse(stored.value)
  if (!parsed.success) {
    console.error('[payouts] stored payout settings are invalid; using manual payouts')
    return { ...structuredClone(defaultPayoutSettings), invalidStoredSettings: true }
  }
  return parsed.data
}

/** The most recent scheduled payout time at or before `now` (a UTC Date). */
export function lastScheduledMoment(now, { frequency, weekday, hour }) {
  const local = new Date(now.getTime() + LAGOS_OFFSET_MS)
  const candidate = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour))
  if (frequency === 'WEEKLY') candidate.setUTCDate(candidate.getUTCDate() - ((local.getUTCDay() - weekday + 7) % 7))
  if (candidate > local) candidate.setUTCDate(candidate.getUTCDate() - (frequency === 'WEEKLY' ? 7 : 1))
  return new Date(candidate.getTime() - LAGOS_OFFSET_MS)
}

export function nextScheduledMoment(now, schedule) {
  const last = lastScheduledMoment(now, schedule)
  return new Date(last.getTime() + (schedule.frequency === 'WEEKLY' ? 7 : 1) * 86_400_000)
}

/** Start of today in Lagos, as a UTC Date (cash-out limits reset at local midnight). */
export function startOfLagosDay(now) {
  const local = new Date(now.getTime() + LAGOS_OFFSET_MS)
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - LAGOS_OFFSET_MS)
}

/** Fee kept by DOORSTEP for a cash-out of `amountMinor`. */
export function withdrawalFee(amountMinor, withdrawals) {
  return withdrawals.feeMinor + Math.round(amountMinor * withdrawals.feePercent / 100)
}
