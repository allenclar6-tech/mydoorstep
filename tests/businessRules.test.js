import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { checkResponse } from '../server/deliveryAssessment.js'
import { defaultDeliveryPricing } from '../server/deliveryPricing.js'
import { deliveryPricingSchema } from '../server/deliveryPricingSettings.js'
import { activateScheduledPricing, SCHEDULED_PRICING_KEY } from '../server/deliveryPricingRoutes.js'
import { areaForPath, can } from '../server/staff.js'

// DOORSTEP's permanent pricing business rules (set by the platform owner, 10 Nov 2026). These tests fail if any
// later change breaks one of them, so a rule can only change with the owner's explicit authorisation.

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const sent = { status: 'QUOTE_SENT', currentVersion: 2, expiresAt: new Date(Date.now() + 3_600_000), reviewRounds: 0 }

test('Rule 1 — customers can never negotiate, bargain or ask for a better delivery price', () => {
  assert.throws(() => checkResponse(sent, { action: 'REVIEW', version: 2, maxRounds: 99 }), (error) => error.code === 'REVIEW_NOT_AVAILABLE')
  const routes = read('server/quotationRoutes.js')
  assert.match(routes, /action: z\.enum\(\['ACCEPT', 'DECLINE'\]\)/, 'the customer API only takes ACCEPT or DECLINE')
  for (const file of ['src/shop/OrdersPages.jsx', 'src/shop/Checkout.jsx', 'src/shop/shopData.js']) {
    const source = read(file)
    assert.doesNotMatch(source, /better price|negotiat|bargain|ask (us )?(for|to) (a )?review|'REVIEW'/i, `${file} offers no way to negotiate`)
  }
  const service = read('server/quotationService.js')
  assert.doesNotMatch(service, /ask us to review/i, 'customer notifications don’t invite negotiation')
})

test('Rule 2 — customers can accept or decline a quotation', () => {
  assert.equal(checkResponse(sent, { action: 'ACCEPT', version: 2, maxRounds: 3 }), 'QUOTE_ACCEPTED')
  assert.equal(checkResponse(sent, { action: 'DECLINE', version: 2, maxRounds: 3 }), 'QUOTE_DECLINED')
  const page = read('src/shop/OrdersPages.jsx')
  assert.match(page, /answer\('ACCEPT'\)/)
  assert.match(page, /answer\('DECLINE'\)/)
})

test('Rule 3 — DOORSTEP administrators set exceptional prices; riders only advise; customers and businesses can’t', () => {
  assert.equal(areaForPath('/api/admin/delivery-quotes/q1/offer'), 'quotes')
  for (const role of ['CUSTOMER', 'RESTAURANT', 'RIDER']) assert.equal(can({ role }, 'quotes'), false, role)
  const checks = read('server/riderPriceChecks.js')
  assert.doesNotMatch(checks, /deliveryQuotationVersion\.create|sendOffer/, 'a rider’s answer never becomes a price by itself')
})

test('Rule 4 — demand-based (surge) pricing is OFF by default and only the owner can switch it on', () => {
  assert.equal(defaultDeliveryPricing.demand.enabled, false)
  const { demand, ...older } = structuredClone(defaultDeliveryPricing)
  assert.equal(deliveryPricingSchema.parse(older).demand.enabled, false, 'settings saved before this feature load with it OFF')
  const routes = read('server/deliveryPricingRoutes.js')
  assert.match(routes, /current\.demand\) !== JSON\.stringify\(parsed\.data\.demand\) && !isOwner\(request\.user\)/, 'the server refuses demand changes from anyone but a Super admin')
})

test('Rule 5 — every pricing setting is managed from the dashboard', () => {
  const page = read('src/admin/DeliveryPricing.jsx')
  for (const key of Object.keys(defaultDeliveryPricing).filter((name) => name !== 'published')) {
    assert.match(page, new RegExp(`\\['${key}'|pricing\\.${key}\\b`), `Delivery prices page manages “${key}”`)
  }
  assert.match(read('src/admin/MerchantDeals.jsx'), /merchant-deals/, 'business delivery deals have their own page')
  assert.match(read('src/admin/DeliveryQuotes.jsx'), /riderPay/, 'rider pay for confirmed prices is set in the dashboard')
})

test('Rule 6 — no pricing change needs a code change: no flat or hard-coded delivery fees in the pricing path', () => {
  for (const file of ['server/deliveryQuote.js', 'server/merchantDeals.js', 'server/quotationService.js']) assert.doesNotMatch(read(file), /\b80_?000\b|\b300_?000\b/, `${file} has no hard-coded fee`)
  const index = read('server/index.js')
  const quoteOrder = index.slice(index.indexOf('async function quoteOrder('), index.indexOf('async function priceOrder('))
  assert.doesNotMatch(quoteOrder, /deliveryFeeMinor = \d|: 80_?000/, 'no flat fallback fee at checkout')
})

test('Rule 7 — prices are worked out on the server; the browser never sends a delivery fee', () => {
  const index = read('server/index.js')
  const schemaLine = index.split('\n').find((line) => line.startsWith('export const orderSchema'))
  assert.doesNotMatch(schemaLine, /deliveryFee|totalMinor|feeMinor/, 'the order API has no fee fields to trust')
  assert.doesNotMatch(read('src/shop/shopData.js').slice(read('src/shop/shopData.js').indexOf('export function buildOrderRequest')).split('\n').slice(0, 8).join('\n'), /deliveryFeeMinor/)
})

test('Scheduled pricing switches on at its time, once, and is audited', async () => {
  const settings = new Map([[SCHEDULED_PRICING_KEY, { pricing: { ...structuredClone(defaultDeliveryPricing), published: true }, activatesAt: '2026-11-10T09:00:00.000Z', by: 'owner' }]])
  const audit = []
  const db = {
    platformSetting: {
      findUnique: async ({ where }) => (settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null),
      deleteMany: async ({ where }) => ({ count: settings.delete(where.key) ? 1 : 0 }),
      upsert: async ({ where, update }) => { settings.set(where.key, update.value); return update },
    },
    auditLog: { create: async ({ data }) => { audit.push(data); return data } },
  }
  db.$transaction = (work) => work(db)
  assert.equal(await activateScheduledPricing(db, new Date('2026-11-10T08:59:00Z')), null, 'not yet')
  const applied = await activateScheduledPricing(db, new Date('2026-11-10T09:00:30Z'))
  assert.equal(applied.published, true)
  assert.equal(settings.get('delivery_pricing').published, true)
  assert.equal(settings.has(SCHEDULED_PRICING_KEY), false)
  assert.equal(audit[0].action, 'DELIVERY_PRICING_ACTIVATED')
  assert.equal(await activateScheduledPricing(db, new Date('2026-11-10T09:01:30Z')), null, 'only once')
})
