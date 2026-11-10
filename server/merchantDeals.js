import { z } from 'zod'

// Business delivery deals: who pays the delivery fee for a business's orders. Set by DOORSTEP admins only
// (Pricing manager / Super admin); a business can see its deal but never change it, and never changes
// platform-wide prices. The rider's pay never depends on the deal — it follows the trip.
//
// DOORSTEP first works out the delivery fee (F) exactly as for any order (distance, area, route, surcharges, or a
// price confirmed by an admin). The deal then splits F between the customer, the business and DOORSTEP:
//   STANDARD       customer pays F (no deal)
//   MERCHANT_PAYS  business pays F (up to an optional cap per order; the customer pays anything above the cap)
//   SHARED         business pays merchantPercent % of F (cap optional), customer pays the rest
//   FIXED_FEE      customer pays a fixed amount; if F is higher, the gap is paid by the business or DOORSTEP
//   PLATFORM_PAYS  DOORSTEP pays F (free delivery funded by DOORSTEP)
// Plus, for any mode, optional free delivery for the customer on baskets of at least freeOverMinor, paid by
// the business or DOORSTEP.
// Deals apply only while active (start/end dates) and only when a DOORSTEP rider delivers.

export const DEAL_MODES = ['STANDARD', 'MERCHANT_PAYS', 'SHARED', 'FIXED_FEE', 'PLATFORM_PAYS']
const minor = z.number().int().min(0).max(10_000_000)
export const dealSchema = z.object({
  mode: z.enum(DEAL_MODES),
  merchantPercent: z.number().min(1).max(99).optional(),
  merchantCapMinor: minor.optional(),
  fixedFeeMinor: minor.optional(),
  fixedGapPaidBy: z.enum(['MERCHANT', 'PLATFORM']).optional(),
  freeOverMinor: minor.optional(),
  freeOverPaidBy: z.enum(['MERCHANT', 'PLATFORM']).optional(),
  startsAt: z.string().datetime({ offset: true }).optional(),
  endsAt: z.string().datetime({ offset: true }).optional(),
  note: z.string().trim().max(300).optional(),
}).strict().superRefine((deal, context) => {
  if (deal.mode === 'SHARED' && deal.merchantPercent == null) context.addIssue({ code: 'custom', message: 'Enter the percentage the business pays.' })
  if (deal.mode === 'FIXED_FEE' && deal.fixedFeeMinor == null) context.addIssue({ code: 'custom', message: 'Enter the fixed delivery fee customers pay.' })
  if (deal.mode === 'FIXED_FEE' && !deal.fixedGapPaidBy) context.addIssue({ code: 'custom', message: 'Choose who pays when the real fee is higher.' })
  if (deal.freeOverMinor != null && !deal.freeOverPaidBy) context.addIssue({ code: 'custom', message: 'Choose who pays for free delivery over the basket amount.' })
  if (deal.startsAt && deal.endsAt && new Date(deal.endsAt) <= new Date(deal.startsAt)) context.addIssue({ code: 'custom', message: 'The end date must be after the start date.' })
})

export const MODE_TEXT = {
  STANDARD: 'Customer pays the delivery fee',
  MERCHANT_PAYS: 'Business pays the delivery fee',
  SHARED: 'Business and customer share the delivery fee',
  FIXED_FEE: 'Customers pay a fixed delivery fee',
  PLATFORM_PAYS: 'DOORSTEP pays the delivery fee',
}

export function dealIsActive(deal, now = new Date()) {
  if (!deal || deal.mode === 'STANDARD' && deal.freeOverMinor == null) return false
  if (deal.startsAt && now < new Date(deal.startsAt)) return false
  if (deal.endsAt && now >= new Date(deal.endsAt)) return false
  return true
}

/**
 * Splits a delivery fee under a deal. Returns { customerMinor, merchantMinor, platformMinor, feeMinor, mode, free }.
 * Always: customerMinor + merchantMinor + platformMinor === max(feeMinor, customerMinor) — nobody pays twice, and
 * the parts never go below zero.
 */
export function applyDeal(feeMinor, { subtotalMinor = 0, deal = null, fulfilment = 'DOORSTEP_RIDER', now = new Date() } = {}) {
  const fee = Math.max(0, Math.round(Number(feeMinor) || 0))
  const none = { feeMinor: fee, customerMinor: fee, merchantMinor: 0, platformMinor: 0, mode: 'STANDARD', free: false }
  if (fulfilment !== 'DOORSTEP_RIDER' || !dealIsActive(deal, now) || fee === 0 && deal.mode !== 'FIXED_FEE') return none

  if (deal.freeOverMinor != null && subtotalMinor >= deal.freeOverMinor) {
    return deal.freeOverPaidBy === 'MERCHANT'
      ? { feeMinor: fee, customerMinor: 0, merchantMinor: fee, platformMinor: 0, mode: deal.mode, free: true }
      : { feeMinor: fee, customerMinor: 0, merchantMinor: 0, platformMinor: fee, mode: deal.mode, free: true }
  }
  const capped = (amount) => Math.min(amount, deal.merchantCapMinor ?? Infinity)
  switch (deal.mode) {
    case 'MERCHANT_PAYS': { const merchant = capped(fee); return { feeMinor: fee, customerMinor: fee - merchant, merchantMinor: merchant, platformMinor: 0, mode: deal.mode, free: merchant === fee } }
    case 'SHARED': { const merchant = capped(Math.round(fee * deal.merchantPercent / 100)); return { feeMinor: fee, customerMinor: fee - merchant, merchantMinor: merchant, platformMinor: 0, mode: deal.mode, free: false } }
    case 'FIXED_FEE': {
      const customer = deal.fixedFeeMinor
      const gap = Math.max(0, fee - customer)
      const merchant = deal.fixedGapPaidBy === 'MERCHANT' ? capped(gap) : 0
      return { feeMinor: fee, customerMinor: customer + (deal.fixedGapPaidBy === 'MERCHANT' ? gap - merchant : 0), merchantMinor: merchant, platformMinor: deal.fixedGapPaidBy === 'PLATFORM' ? gap : 0, mode: deal.mode, free: customer === 0 }
    }
    case 'PLATFORM_PAYS': return { feeMinor: fee, customerMinor: 0, merchantMinor: 0, platformMinor: fee, mode: deal.mode, free: true }
    default: return none
  }
}

/** What the customer is told (never the business's or DOORSTEP's internal amounts beyond "paid by"). */
export function customerDealNote(split, storeName) {
  if (!split || split.mode === 'STANDARD' && !split.free) return null
  const covered = split.merchantMinor + split.platformMinor
  if (!covered) return null
  const payer = split.merchantMinor >= split.platformMinor ? storeName || 'the store' : 'DOORSTEP'
  return { savedMinor: covered, text: split.free ? `Free delivery, paid by ${payer}` : `${payer} pays part of your delivery` }
}

/** The business can contribute at most what it earns on the order (its share before the contribution). */
export function boundedContribution(split, partnerShareBeforeMinor) {
  const merchant = Math.min(split.merchantMinor, Math.max(0, partnerShareBeforeMinor))
  const shortfall = split.merchantMinor - merchant
  return { ...split, merchantMinor: merchant, platformMinor: split.platformMinor + shortfall }
}
