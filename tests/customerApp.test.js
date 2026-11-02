import assert from 'node:assert/strict'
import test from 'node:test'
import { checkSchedule, choosePromotion, cleanTip, heldForSchedule, platformRoom, promoLabel, promoProblem, rawDiscount, verticalOf } from '../server/promotions.js'
import { deliverability, discoverSections, etaRange, parsePrepRange } from '../server/customerApp.js'
import { orderPaidEntries, orderShares } from '../server/financeService.js'

const settings = { commission: { doorstepRiderPercent: 15, ownRiderPercent: 10 } }
const now = new Date('2026-11-01T12:00:00Z')
const promo = (overrides = {}) => ({ id: 'p1', name: 'Welcome', code: 'WELCOME', type: 'FREE_DELIVERY', active: true, startsAt: new Date('2026-10-01'), endsAt: new Date('2026-12-31'), minSubtotalMinor: 0, perCustomerLimit: 1, firstOrderOnly: false, autoApply: false, ...overrides })
const fakeDb = ({ promos = [], orders = [] } = {}) => ({
  promotion: { findFirst: async ({ where }) => promos.find((entry) => entry.code === where.code) || null, findMany: async () => promos.filter((entry) => entry.autoApply) },
  order: { count: async ({ where }) => orders.filter((order) => (!where.customerId || order.customerId === where.customerId) && (!where.promotionId || order.promotionId === where.promotionId) && (where.status?.notIn ? !where.status.notIn.includes(order.status) : true)).length },
})
const basket = { customerId: 'c1', restaurantId: 'r1', vertical: 'FOOD', subtotalMinor: 500_000, deliveryFeeMinor: 80_000, orderType: 'DELIVERY', now }

test('discount amounts and labels', () => {
  assert.equal(rawDiscount(promo(), basket), 80_000)
  assert.equal(rawDiscount(promo({ type: 'PERCENT', percentage: 10, maxDiscountMinor: 30_000 }), basket), 30_000)
  assert.equal(rawDiscount(promo({ type: 'FIXED', valueMinor: 1_000_000 }), basket), 500_000)
  assert.equal(promoLabel(promo({ type: 'PERCENT', percentage: 10, maxDiscountMinor: 100_000 })), '10% off (up to ₦1,000)')
})

test('promo rules: pickup, minimum, first order, already used', async () => {
  assert.equal((await promoProblem(fakeDb(), promo(), { ...basket, orderType: 'PICKUP' })).code, 'PROMO_DELIVERY_ONLY')
  assert.equal((await promoProblem(fakeDb(), promo({ minSubtotalMinor: 600_000 }), basket)).code, 'PROMO_MINIMUM')
  assert.equal((await promoProblem(fakeDb({ orders: [{ customerId: 'c1', status: 'DELIVERED' }] }), promo({ firstOrderOnly: true }), basket)).code, 'PROMO_FIRST_ORDER')
  assert.equal((await promoProblem(fakeDb({ orders: [{ customerId: 'c1', status: 'CANCELLED' }] }), promo({ firstOrderOnly: true }), basket)), null)
  assert.equal((await promoProblem(fakeDb({ orders: [{ customerId: 'c1', promotionId: 'p1', status: 'PAID' }] }), promo(), basket)).code, 'PROMO_ALREADY_USED')
  assert.equal((await promoProblem(fakeDb(), promo({ endsAt: new Date('2026-10-30') }), basket)).code, 'PROMO_EXPIRED')
  assert.equal((await promoProblem(fakeDb(), promo({ restaurantId: 'other' }), basket)).code, 'PROMO_OTHER_STORE')
})

test('a discount never cuts into the business share', async () => {
  const shares = orderShares({ subtotalMinor: 500_000, deliveryFeeMinor: 80_000, serviceFeeMinor: 15_000, totalMinor: 595_000 }, 'DOORSTEP_RIDER', settings)
  const room = platformRoom(shares)
  assert.equal(room, 75_000 + 15_000 + 80_000)
  const chosen = await choosePromotion(fakeDb({ promos: [promo({ type: 'FIXED', valueMinor: 400_000 })] }), basket, { code: 'welcome', roomMinor: room })
  assert.equal(chosen.discountMinor, room)
  assert.equal(chosen.capped, true)
  const total = 595_000 - chosen.discountMinor
  const final = orderShares({ subtotalMinor: 500_000, deliveryFeeMinor: 80_000, serviceFeeMinor: 15_000, discountMinor: chosen.discountMinor, totalMinor: total }, 'DOORSTEP_RIDER', settings)
  assert.equal(final.partnerShareMinor, 425_000)
  assert.ok(total >= final.partnerShareMinor)
})

test('automatic first-order offer is picked when no code is typed', async () => {
  const db = fakeDb({ promos: [promo({ code: null, autoApply: true, firstOrderOnly: true })] })
  const chosen = await choosePromotion(db, basket, { roomMinor: 200_000 })
  assert.equal(chosen.discountMinor, 80_000)
  assert.equal(chosen.auto, true)
  const typedBad = await choosePromotion(db, basket, { code: 'NOPE', roomMinor: 200_000 })
  assert.equal(typedBad.problem.code, 'PROMO_NOT_FOUND')
})

test('tips, pickup and ledger rows', () => {
  assert.equal(cleanTip(20_000, 'DELIVERY'), 20_000)
  assert.equal(cleanTip(20_000, 'PICKUP'), 0)
  assert.equal(cleanTip(-5, 'DELIVERY'), 0)
  const shares = orderShares({ subtotalMinor: 500_000, deliveryFeeMinor: 80_000, serviceFeeMinor: 15_000, tipMinor: 20_000, discountMinor: 80_000, totalMinor: 535_000 }, 'DOORSTEP_RIDER', settings)
  assert.equal(shares.partnerShareMinor, 425_000)
  const entries = orderPaidEntries({ id: 'o1', orderNumber: 'DSP-1', restaurantId: 'r1', promoCode: 'WELCOME' }, shares, { splitSettled: false })
  assert.equal(entries.find((entry) => entry.type === 'PROMO_DISCOUNT').amountMinor, -80_000)
  assert.throws(() => orderShares({ subtotalMinor: 500_000, deliveryFeeMinor: 0, serviceFeeMinor: 15_000, tipMinor: 1, totalMinor: 515_000 }, 'PICKUP', settings))
  const pickup = orderShares({ subtotalMinor: 500_000, deliveryFeeMinor: 0, serviceFeeMinor: 15_000, totalMinor: 515_000 }, 'PICKUP', settings)
  assert.equal(pickup.commissionPercent, 10)
})

test('scheduled orders', () => {
  assert.ok(checkSchedule(new Date(now.getTime() + 20 * 60_000).toISOString(), now).problem)
  assert.ok(checkSchedule(new Date(now.getTime() + 8 * 86_400_000).toISOString(), now).problem)
  assert.ok(checkSchedule(new Date(now.getTime() + 2 * 3_600_000).toISOString(), now).at)
  assert.equal(checkSchedule('', now).at, null)
  assert.equal(heldForSchedule({ scheduledFor: new Date(now.getTime() + 2 * 3_600_000) }, now), true)
  assert.equal(heldForSchedule({ scheduledFor: new Date(now.getTime() + 30 * 60_000) }, now), false)
  assert.equal(heldForSchedule({ scheduledFor: null }, now), false)
})

test('store sections, delivery check and rankings', () => {
  assert.equal(verticalOf({ storeType: 'GROCERY' }), 'GROCERIES')
  assert.equal(verticalOf({ storeType: 'GROCERY', vertical: 'PHARMACY_BEAUTY' }), 'PHARMACY_BEAUTY')
  assert.equal(deliverability({ point: { latitude: 6.45, longitude: 3.39 } }, { pricing: {}, zones: [] }).reason, 'TOO_FAR')
  assert.equal(deliverability({ point: { latitude: 5.89, longitude: 5.68 } }, { pricing: {}, zones: [] }).deliverable, true)
  assert.equal(deliverability({ point: { latitude: 5.89, longitude: 5.68 } }, { pricing: { coverage: { requireApprovedZone: true } }, zones: [] }).reason, 'NOT_COVERED')
  const stores = [
    { id: 'a', rating: 4.8, ratingCount: 10, items: [{ price: 3000 }], createdAt: '2026-01-01' },
    { id: 'b', rating: 4.1, ratingCount: 2, items: [{ price: 1500 }], createdAt: '2026-10-20' },
    { id: 'c', rating: 0, ratingCount: 0, items: [], createdAt: '2026-01-01' },
  ]
  const sections = discoverSections(stores, new Map([['a', { orders30: 3, delivered30: 2 }], ['b', { orders30: 9, delivered30: 1 }]]), { now })
  assert.deepEqual(sections.mostInDemand, ['b', 'a'])
  assert.deepEqual(sections.budgetFriendly, ['b', 'a'])
  assert.deepEqual(sections.topRated, ['a'])
  assert.deepEqual(sections.topPerformers, ['a', 'b'])
  assert.deepEqual(sections.newest, ['b'])
  assert.deepEqual(etaRange({ prepTimeMinutes: 20 }), [30, 45])
})

test('preparation time can be a single number or a range', () => {
  assert.deepEqual(parsePrepRange('45'), { min: 45, max: null })
  assert.deepEqual(parsePrepRange('45-70'), { min: 45, max: 70 })
  assert.deepEqual(parsePrepRange('45 – 70 mins'), { min: 45, max: 70 })
  assert.deepEqual(parsePrepRange('45 to 70'), { min: 45, max: 70 })
  assert.deepEqual(parsePrepRange(30), { min: 30, max: null })
  assert.deepEqual(parsePrepRange(''), { min: null, max: null })
  assert.ok(parsePrepRange('70-45').error)
  assert.ok(parsePrepRange('241').error)
  assert.ok(parsePrepRange('abc').error)
  assert.deepEqual(etaRange({ prepTimeMinutes: 45, prepTimeMaxMinutes: 70 }), [55, 85])
  assert.deepEqual(etaRange({ prepTimeMinutes: 45, prepTimeMaxMinutes: 70 }, { orderType: 'PICKUP' }), [45, 70])
})
