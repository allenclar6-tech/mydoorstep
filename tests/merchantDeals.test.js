import assert from 'node:assert/strict'
import test from 'node:test'
import { applyDeal, boundedContribution, customerDealNote, dealIsActive, dealSchema } from '../server/merchantDeals.js'
import { orderPaidEntries } from '../server/financeService.js'

const F = 150_000 // ₦1,500 delivery fee worked out by DOORSTEP
const sumParts = (split) => split.customerMinor + split.merchantMinor + split.platformMinor

test('each deal splits the fee with nobody paying twice', () => {
  assert.deepEqual(applyDeal(F, { deal: null }), { feeMinor: F, customerMinor: F, merchantMinor: 0, platformMinor: 0, mode: 'STANDARD', free: false })
  const merchant = applyDeal(F, { deal: { mode: 'MERCHANT_PAYS' } })
  assert.equal(merchant.customerMinor, 0); assert.equal(merchant.merchantMinor, F)
  const capped = applyDeal(F, { deal: { mode: 'MERCHANT_PAYS', merchantCapMinor: 100_000 } })
  assert.deepEqual([capped.customerMinor, capped.merchantMinor], [50_000, 100_000], 'customer pays above the cap')
  const shared = applyDeal(F, { deal: { mode: 'SHARED', merchantPercent: 40 } })
  assert.deepEqual([shared.customerMinor, shared.merchantMinor], [90_000, 60_000])
  const fixedPlatform = applyDeal(F, { deal: { mode: 'FIXED_FEE', fixedFeeMinor: 50_000, fixedGapPaidBy: 'PLATFORM' } })
  assert.deepEqual([fixedPlatform.customerMinor, fixedPlatform.merchantMinor, fixedPlatform.platformMinor], [50_000, 0, 100_000])
  const fixedBelow = applyDeal(30_000, { deal: { mode: 'FIXED_FEE', fixedFeeMinor: 50_000, fixedGapPaidBy: 'PLATFORM' } })
  assert.equal(fixedBelow.customerMinor, 50_000, 'a fixed fee is the fixed fee, even on a short trip')
  const platform = applyDeal(F, { deal: { mode: 'PLATFORM_PAYS' } })
  assert.deepEqual([platform.customerMinor, platform.platformMinor], [0, F])
  for (const split of [merchant, capped, shared, fixedPlatform, platform]) assert.equal(sumParts(split), F)
})

test('free delivery over a basket amount, dates, and business-rider orders', () => {
  const deal = { mode: 'STANDARD', freeOverMinor: 1_000_000, freeOverPaidBy: 'MERCHANT' }
  assert.equal(applyDeal(F, { deal, subtotalMinor: 900_000 }).customerMinor, F)
  const free = applyDeal(F, { deal, subtotalMinor: 1_000_000 })
  assert.deepEqual([free.customerMinor, free.merchantMinor, free.free], [0, F, true])
  const now = new Date('2026-11-10T12:00:00Z')
  assert.equal(dealIsActive({ mode: 'MERCHANT_PAYS', startsAt: '2026-11-11T00:00:00+01:00' }, now), false, 'not started')
  assert.equal(dealIsActive({ mode: 'MERCHANT_PAYS', endsAt: '2026-11-10T00:00:00+01:00' }, now), false, 'ended')
  assert.equal(applyDeal(F, { deal: { mode: 'MERCHANT_PAYS', startsAt: '2026-11-11T00:00:00+01:00' }, now }).customerMinor, F)
  assert.equal(applyDeal(F, { deal: { mode: 'MERCHANT_PAYS' }, fulfilment: 'BUSINESS_RIDER' }).customerMinor, F, 'deals apply to DOORSTEP deliveries only')
})

test('a business never pays more than it earns on the order; the rest falls to DOORSTEP', () => {
  const split = applyDeal(F, { deal: { mode: 'MERCHANT_PAYS' } })
  const bounded = boundedContribution(split, 40_000)
  assert.deepEqual([bounded.merchantMinor, bounded.platformMinor], [40_000, 110_000])
  assert.equal(sumParts(bounded), F)
})

test('the customer is told who pays, never the internal split', () => {
  const note = customerDealNote(applyDeal(F, { deal: { mode: 'MERCHANT_PAYS' } }), 'Mama Put')
  assert.deepEqual(note, { savedMinor: F, text: 'Free delivery, paid by Mama Put' })
  assert.equal(customerDealNote(applyDeal(F, { deal: null }), 'Mama Put'), null)
})

test('deal validation', () => {
  assert.equal(dealSchema.safeParse({ mode: 'SHARED' }).success, false)
  assert.equal(dealSchema.safeParse({ mode: 'FIXED_FEE', fixedFeeMinor: 50_000 }).success, false, 'must say who pays the gap')
  assert.equal(dealSchema.safeParse({ mode: 'MERCHANT_PAYS', startsAt: '2026-12-01T00:00:00+01:00', endsAt: '2026-11-01T00:00:00+01:00' }).success, false)
  assert.equal(dealSchema.safeParse({ mode: 'SHARED', merchantPercent: 50, extra: 1 }).success, false)
  assert.equal(dealSchema.safeParse({ mode: 'SHARED', merchantPercent: 50 }).success, true)
})

test('ledger: the business share is shown before its contribution, with the contribution and any DOORSTEP subsidy as their own lines', () => {
  const order = { id: 'o1', orderNumber: 'DSP-1', restaurantId: 'r1', deliveryFunding: { feeMinor: F, customerMinor: 50_000, merchantMinor: 60_000, platformMinor: 40_000 } }
  const shares = { commissionPercent: 15, commissionMinor: 90_000, serviceFeeMinor: 20_000, deliveryFeeToPlatformMinor: 50_000, discountMinor: 0, partnerShareMinor: 450_000 }
  const entries = orderPaidEntries(order, shares, { splitSettled: false })
  const business = entries.filter((entry) => entry.party === 'RESTAURANT')
  assert.deepEqual(business.map((entry) => [entry.type, entry.amountMinor]), [['PARTNER_SHARE', 510_000], ['DELIVERY_CONTRIBUTION', -60_000]])
  assert.equal(business.reduce((sum, entry) => sum + entry.amountMinor, 0), shares.partnerShareMinor, 'what the business is owed is unchanged')
  const platform = Object.fromEntries(entries.filter((entry) => entry.party === 'PLATFORM').map((entry) => [entry.type, entry.amountMinor]))
  assert.equal(platform.DELIVERY_CONTRIBUTION, 60_000)
  assert.equal(platform.DELIVERY_SUBSIDY, -40_000)
  assert.equal(new Set(entries.map((entry) => entry.dedupeKey)).size, entries.length, 'every line has its own dedupe key (no double counting)')
  assert.equal(orderPaidEntries({ ...order, deliveryFunding: null }, shares, { splitSettled: false }).some((entry) => /DELIVERY_(CONTRIBUTION|SUBSIDY)/.test(entry.type)), false)
})
