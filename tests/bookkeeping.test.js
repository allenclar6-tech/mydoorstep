import assert from 'node:assert/strict'
import test from 'node:test'
import { buildStatement, parsePeriod, statementCsv, toCsv } from '../server/bookkeeping.js'

const at = (iso) => new Date(`${iso}+01:00`)
const period = { from: at('2026-11-01T00:00:00'), to: at('2026-12-01T00:00:00'), fromDay: '2026-11-01', toDay: '2026-11-30' }

// A rider's real-world month: an October job paid in October, November jobs (earning, 6% fee, tip),
// a cash-out with a fee, a failed payout (money went back to owed), a cancelled job, and one still to price.
const entries = [
  { id: 'e0', type: 'RIDER_EARNING', amountMinor: 100_000, status: 'PAID', orderId: 'o0', payoutId: 'p0', createdAt: at('2026-10-20T10:00:00'), description: 'DSP-0 delivery' },
  { id: 'e0f', type: 'RIDER_SERVICE_FEE', amountMinor: -6_000, status: 'PAID', orderId: 'o0', payoutId: 'p0', createdAt: at('2026-10-20T10:00:00'), description: 'Fee' },
  { id: 'e1', type: 'RIDER_EARNING', amountMinor: 150_000, status: 'PAID', orderId: 'o1', payoutId: 'p1', createdAt: at('2026-11-03T12:00:00'), description: 'DSP-1 delivery' },
  { id: 'e1f', type: 'RIDER_SERVICE_FEE', amountMinor: -9_000, status: 'PAID', orderId: 'o1', payoutId: 'p1', createdAt: at('2026-11-03T12:00:00'), description: 'Fee' },
  { id: 'e1t', type: 'TIP', amountMinor: 20_000, status: 'PAID', orderId: 'o1', payoutId: 'p1', createdAt: at('2026-11-03T12:05:00'), description: 'Tip' },
  { id: 'wf', type: 'WITHDRAWAL_FEE', amountMinor: -5_000, status: 'PAID', payoutId: 'p1', createdAt: at('2026-11-05T09:00:00'), description: 'Cash-out fee (₦50)' },
  { id: 'e2', type: 'RIDER_EARNING', amountMinor: 120_000, status: 'DUE', orderId: 'o2', createdAt: at('2026-11-10T18:00:00'), description: 'DSP-2 delivery' },
  { id: 'e2f', type: 'RIDER_SERVICE_FEE', amountMinor: -7_200, status: 'DUE', orderId: 'o2', createdAt: at('2026-11-10T18:00:00'), description: 'Fee' },
  { id: 'e3', type: 'RIDER_EARNING', amountMinor: 90_000, status: 'DUE', orderId: 'o3', createdAt: at('2026-11-12T08:00:00'), description: 'DSP-3 delivery' },
  { id: 'e3f', type: 'RIDER_SERVICE_FEE', amountMinor: -5_400, status: 'DUE', orderId: 'o3', createdAt: at('2026-11-12T08:00:00'), description: 'Fee' },
  { id: 'void', type: 'RIDER_EARNING', amountMinor: 80_000, status: 'VOID', orderId: 'o4', createdAt: at('2026-11-13T08:00:00'), description: 'Cancelled' },
  { id: 'nr', type: 'RIDER_EARNING', amountMinor: 0, status: 'NEEDS_REVIEW', orderId: 'o5', createdAt: at('2026-11-14T08:00:00'), description: 'DSP-5: needs a price' },
]
const payouts = [
  { id: 'p0', amountMinor: 94_000, status: 'PAID', method: 'PAYSTACK_TRANSFER', reference: 'PAYOUT-AAAA000000', createdAt: at('2026-10-25T09:00:00'), bankSnapshot: { bankName: 'GTBank', last4: '1234' } },
  { id: 'p1', amountMinor: 156_000, feeMinor: 5_000, status: 'PAID', method: 'PAYSTACK_TRANSFER', reference: 'PAYOUT-BBBB000000', createdAt: at('2026-11-05T09:00:00') },
  { id: 'pf', amountMinor: 197_400, status: 'FAILED', method: 'PAYSTACK_TRANSFER', reference: 'PAYOUT-CCCC000000', createdAt: at('2026-11-15T09:00:00') },
]
const refs = { 'order:o1': 'DSP-1', 'order:o2': 'DSP-2', 'order:o3': 'DSP-3', 'order:o5': 'DSP-5' }

test('statement: opening balance, one line per job (earning + fee + tip), payouts, closing balance', () => {
  const statement = buildStatement({ entries, payouts, ...period, refs })
  assert.equal(statement.openingMinor, 0, 'October was earned and paid in full')
  const jobs = statement.lines.filter((line) => line.kind === 'JOB')
  assert.deepEqual(jobs.map((line) => line.ref), ['DSP-1', 'DSP-2', 'DSP-3'])
  assert.equal(jobs[0].amountMinor, 161_000, '₦1,500 − ₦90 fee + ₦200 tip')
  assert.deepEqual(jobs[0].parts.map((part) => part.label), ['Delivery earning', 'DOORSTEP rider fee', 'Customer tip'])
  assert.equal(statement.lines.filter((line) => line.kind === 'PAYOUT').length, 1, 'the failed payout is not money paid')
  assert.equal(statement.totals.earnedMinor, 380_000)
  assert.equal(statement.totals.feesMinor, 9_000 + 5_000 + 7_200 + 5_400)
  assert.equal(statement.totals.paidOutMinor, 156_000)
  assert.equal(statement.closingMinor, 197_400)
  assert.equal(statement.lines.at(-1).balanceMinor, statement.closingMinor, 'running balance ends at the closing balance')
  assert.deepEqual(statement.awaitingPrice.map((row) => row.ref), ['DSP-5'], 'unpriced work is listed, not counted')
})

test('the closing balance always equals what is owed (the DUE lines) — books reconcile', () => {
  const owed = entries.filter((entry) => entry.status === 'DUE').reduce((sum, entry) => sum + entry.amountMinor, 0)
  const toNow = buildStatement({ entries, payouts, from: at('2026-01-01T00:00:00'), to: at('2027-01-01T00:00:00'), refs })
  assert.equal(toNow.closingMinor, owed)
  // Splitting the year into months: each month opens where the last one closed.
  const october = buildStatement({ entries, payouts, from: at('2026-10-01T00:00:00'), to: at('2026-11-01T00:00:00') })
  const november = buildStatement({ entries, payouts, ...period })
  assert.equal(october.closingMinor, november.openingMinor)
  // A payout still being sent counts as paid out (its lines are no longer owed).
  const inFlight = entries.map((entry) => (entry.status === 'DUE' ? { ...entry, status: 'PAYING', payoutId: 'p2' } : entry))
  const sending = [...payouts, { id: 'p2', amountMinor: owed, status: 'PROCESSING', method: 'PAYSTACK_TRANSFER', reference: 'PAYOUT-DDDD', createdAt: at('2026-11-20T09:00:00') }]
  assert.equal(buildStatement({ entries: inFlight, payouts: sending, ...period }).closingMinor, 0)
})

test('business paid by Paystack split at checkout: the share and the automatic payment both show', () => {
  const statement = buildStatement({ entries: [
    { id: 's1', type: 'PARTNER_SHARE', amountMinor: 850_000, status: 'SETTLED_BY_SPLIT', orderId: 'o9', createdAt: at('2026-11-02T13:00:00'), description: 'DSP-9 sales share' },
    { id: 's2', type: 'PARTNER_SHARE', amountMinor: 400_000, status: 'DUE', orderId: 'o10', createdAt: at('2026-11-04T13:00:00'), description: 'DSP-10 sales share' },
  ], payouts: [], ...period, refs: { 'order:o9': 'DSP-9' } })
  assert.equal(statement.totals.earnedMinor, 1_250_000)
  assert.equal(statement.totals.paidBySplitMinor, 850_000)
  assert.equal(statement.closingMinor, 400_000)
  assert.equal(statement.lines.find((line) => line.kind === 'SPLIT').ref, 'DSP-9')
})

test('periods are Lagos days, inclusive; bad or huge ranges are refused', () => {
  const p = parsePeriod({ from: '2026-11-01', to: '2026-11-30' })
  assert.equal(p.from.toISOString(), '2026-10-31T23:00:00.000Z')
  assert.equal(p.to.toISOString(), '2026-11-30T23:00:00.000Z')
  const current = parsePeriod({}, new Date('2026-11-09T22:30:00Z'))
  assert.equal(current.fromDay, '2026-11-01')
  assert.equal(current.toDay, '2026-11-09')
  assert.throws(() => parsePeriod({ from: '2026-11-10', to: '2026-11-01' }), (error) => error.code === 'INVALID_PERIOD')
  assert.throws(() => parsePeriod({ from: '2024-01-01', to: '2026-11-01' }), (error) => error.code === 'INVALID_PERIOD')
})

test('CSV: opens in Excel, numbers stay numbers, text can’t run as a formula', () => {
  const csv = toCsv([['Name', 'Amount'], ['=HYPERLINK("x")', -1500.5], ['Ade, "Bros"', 0]])
  assert.ok(csv.startsWith('﻿'), 'UTF-8 marker so ₦ shows correctly in Excel')
  assert.match(csv, /'=HYPERLINK/)
  assert.match(csv, /,-1500\.5\r\n/)
  assert.match(csv, /"Ade, ""Bros"""/)
  const statement = buildStatement({ entries, payouts, ...period, refs })
  const text = statementCsv({ name: 'Tunde Bello', kind: 'RIDER', period, statement })
  assert.match(text, /Opening balance/)
  assert.match(text, /DSP-2/)
  assert.match(text, /Closing balance,3800,266,1560,1974/)
  assert.match(text, /Waiting for DOORSTEP to set the price/)
})
