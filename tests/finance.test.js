import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultFinanceSettings, fulfilmentAdjustment, orderPaidEntries, orderShares, paystackSplit, plannedFulfilment, riderEarning, splitSettledTo } from '../server/financeService.js'

const settings = structuredClone(defaultFinanceSettings)
const order = { id: 'o1', orderNumber: 'DSP-1', restaurantId: 'r1', subtotalMinor: 1_000_000, deliveryFeeMinor: 80_000, serviceFeeMinor: 30_000, totalMinor: 1_110_000 }

test('DOORSTEP rider: 15% commission on the subtotal; DOORSTEP keeps commission, service and delivery fees', () => {
  const shares = orderShares(order, 'DOORSTEP_RIDER', settings)
  assert.equal(shares.commissionPercent, 15)
  assert.equal(shares.commissionMinor, 150_000)
  assert.equal(shares.partnerShareMinor, 850_000)
  assert.equal(shares.platformShareMinor, 260_000) // 150k commission + 30k service + 80k delivery
  assert.equal(shares.partnerShareMinor + shares.platformShareMinor, order.totalMinor, 'nothing is lost or created')
})

test('business’s own rider: 10% commission and the business keeps the delivery fee', () => {
  const shares = orderShares(order, 'BUSINESS_RIDER', settings)
  assert.equal(shares.commissionMinor, 100_000)
  assert.equal(shares.partnerShareMinor, 980_000) // 900k food + 80k delivery
  assert.equal(shares.platformShareMinor, 130_000) // 100k commission + 30k service
  assert.equal(shares.deliveryFeeToPlatformMinor, 0)
})

test('delivery preference decides the plan; "both" defaults to DOORSTEP riders', () => {
  assert.equal(plannedFulfilment('OWN_RIDERS'), 'BUSINESS_RIDER')
  assert.equal(plannedFulfilment('DOORSTEP_RIDERS'), 'DOORSTEP_RIDER')
  assert.equal(plannedFulfilment('BOTH'), 'DOORSTEP_RIDER')
  assert.equal(plannedFulfilment(undefined), 'DOORSTEP_RIDER')
})

test('if a "both" business delivers with its own rider, it is credited the difference', () => {
  const planned = orderShares(order, 'DOORSTEP_RIDER', settings)
  const actual = orderShares(order, 'BUSINESS_RIDER', settings)
  const adjustment = fulfilmentAdjustment(order, planned, actual)
  assert.equal(adjustment.amountMinor, 130_000) // 5% of 1,000,000 + 80,000 delivery fee
  assert.equal(adjustment.status, 'DUE')
  assert.equal(fulfilmentAdjustment(order, planned, planned), null)
})

test('broken amounts are refused rather than split wrongly', () => {
  assert.throws(() => orderShares({ ...order, totalMinor: 1 }, 'DOORSTEP_RIDER', settings))
  assert.throws(() => orderShares({ ...order, subtotalMinor: 10.5 }, 'DOORSTEP_RIDER', settings))
})

test('Paystack split sends only the business share to its subaccount', () => {
  assert.deepEqual(paystackSplit({ subaccountCode: 'ACCT_x', partnerShareMinor: 850_000 }, settings), { type: 'flat', bearer_type: 'account', subaccounts: [{ subaccount: 'ACCT_x', share: 850_000 }] })
  assert.equal(paystackSplit({ subaccountCode: null, partnerShareMinor: 850_000 }, settings), null, 'no bank account yet → DOORSTEP holds it and pays out later')
  assert.equal(paystackSplit({ subaccountCode: 'ACCT_x', partnerShareMinor: 850_000 }, { ...settings, split: { enabled: false, feeBearer: 'account' } }), null)
})

test('ledger rows mark split-settled shares as paid by Paystack, otherwise owed', () => {
  const shares = orderShares(order, 'DOORSTEP_RIDER', settings)
  const settled = orderPaidEntries(order, shares, { splitSettled: true })
  assert.equal(settled.find((row) => row.type === 'PARTNER_SHARE').status, 'SETTLED_BY_SPLIT')
  assert.equal(settled.filter((row) => row.party === 'PLATFORM').reduce((sum, row) => sum + row.amountMinor, 0), shares.platformShareMinor)
  assert.equal(orderPaidEntries(order, shares, { splitSettled: false }).find((row) => row.type === 'PARTNER_SHARE').status, 'DUE')
  assert.ok(settled.every((row) => row.dedupeKey), 'every row is idempotent')
  assert.equal(splitSettledTo({ subaccountCode: 'ACCT_x' }, 'ACCT_x'), true)
  assert.equal(splitSettledTo({ split: { shares: { subaccounts: [{ subaccount_code: 'ACCT_x' }] } } }, 'ACCT_x'), true)
  assert.equal(splitSettledTo({ subaccountCode: null, split: null }, 'ACCT_x'), false)
})

test('rider pay follows the published distance bands and is never guessed', () => {
  assert.equal(riderEarning(3000, settings).amountMinor, null, 'off until DOORSTEP publishes rates')
  const published = { ...settings, riderPay: { enabled: true, bands: [{ upToKm: 2, amountMinor: 50_000 }, { upToKm: 5, amountMinor: 80_000 }, { upToKm: 8, amountMinor: 120_000 }], perKmAfterMinor: 15_000 } }
  assert.equal(riderEarning(1500, published).amountMinor, 50_000)
  assert.equal(riderEarning(2000, published).amountMinor, 50_000, 'band limits are inclusive')
  assert.equal(riderEarning(4100, published).amountMinor, 80_000)
  assert.equal(riderEarning(9300, published).amountMinor, 120_000 + 2 * 15_000, 'beyond the last band: per started km')
  assert.equal(riderEarning(null, published).reason, 'DISTANCE_UNKNOWN')
})

