import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { businessOrderView } from '../server/orderViews.js'

// Rider pay terms (DOORSTEP's rider fee and the rider rate card) are only between DOORSTEP and its riders.

test('a business sees its own order and share, never the rider’s pay or DOORSTEP’s delivery margin', () => {
  const order = {
    id: 'o1', orderNumber: 'DSP-1', subtotalMinor: 500_000, totalMinor: 580_000, partnerShareMinor: 425_000, commissionPercent: 15,
    plannedRiderPayMinor: 120_000, agreedRiderId: 'rider9',
    deliveryQuote: { km: 4.2, dropoffZone: { id: 'z', name: 'Amukpe' }, rider: { payMinor: 120_000 }, commission: { percent: 15 }, deliveryMarginMinor: 30_000, doorstepRevenueMinor: 105_000 },
  }
  const view = businessOrderView(order)
  assert.equal(view.partnerShareMinor, 425_000, 'their own money stays')
  assert.deepEqual(view.deliveryDetails, { km: 4.2, area: 'Amukpe' })
  for (const hidden of ['plannedRiderPayMinor', 'agreedRiderId', 'deliveryQuote']) assert.equal(hidden in view, false, hidden)
  assert.doesNotMatch(JSON.stringify(view), /120000|payMinor|deliveryMarginMinor|doorstepRevenueMinor/)
})

test('earnings summary: riders get the rider fee and rate card, businesses only their commission', () => {
  const source = readFileSync(new URL('../server/financeRoutes.js', import.meta.url), 'utf8')
  const rates = source.slice(source.indexOf('rates: who.kind'), source.indexOf('entries, payouts: payouts.map'))
  const [riderPart, businessPart] = rates.split(/\n\s*: \{/)
  assert.match(riderPart, /riderFeePercent/)
  assert.match(riderPart, /riderPay/)
  assert.doesNotMatch(businessPart, /riderFee|riderPay/)
  assert.match(businessPart, /doorstepRiderPercent/)
})
