import test from 'node:test'
import assert from 'node:assert/strict'
import { localDay, pausedNow, todayStats } from '../server/partnerToday.js'

const now = new Date('2026-11-02T19:30:00Z') // 20:30 in Sapele

test('a timed pause ends by itself; an open-ended pause does not', () => {
  assert.equal(pausedNow({ temporarilyClosed: false }, now), false)
  assert.equal(pausedNow({ temporarilyClosed: true, pausedUntil: null }, now), true)
  assert.equal(pausedNow({ temporarilyClosed: true, pausedUntil: new Date(now.getTime() + 60_000) }, now), true)
  assert.equal(pausedNow({ temporarilyClosed: true, pausedUntil: new Date(now.getTime() - 60_000) }, now), false)
})

test('days are counted in Sapele time, not UTC', () => {
  assert.equal(localDay(new Date('2026-11-02T23:30:00Z')), '2026-11-03')
})

test('today, the week, live counts and best sellers come from real orders only', () => {
  const orders = [
    { status: 'DELIVERED', subtotalMinor: 500000, createdAt: '2026-11-02T10:00:00Z', items: [{ nameSnapshot: 'Jollof rice', quantity: 2 }] },
    { status: 'PAID', subtotalMinor: 300000, createdAt: '2026-11-02T19:00:00Z', items: [{ nameSnapshot: 'Suya', quantity: 1 }] },
    { status: 'PREPARING', subtotalMinor: 200000, createdAt: '2026-11-01T12:00:00Z', items: [{ nameSnapshot: 'Jollof rice', quantity: 1 }] },
    { status: 'CANCELLED', subtotalMinor: 900000, createdAt: '2026-11-02T11:00:00Z', items: [{ nameSnapshot: 'Big tray', quantity: 5 }] },
    { status: 'PENDING_PAYMENT', subtotalMinor: 100000, createdAt: '2026-11-02T11:00:00Z', items: [] },
  ]
  const stats = todayStats(orders, now)
  assert.deepEqual(stats.today, { orders: 2, salesMinor: 800000, averageMinor: 400000 })
  assert.deepEqual(stats.live, { new: 1, preparing: 1, ready: 0, onTheWay: 0 })
  assert.equal(stats.week.length, 7)
  assert.equal(stats.week[6].label, 'Today')
  assert.equal(stats.week[5].salesMinor, 200000)
  assert.deepEqual(stats.weekTotals, { salesMinor: 1000000, orders: 3 })
  assert.deepEqual(stats.best[0], { name: 'Jollof rice', count: 3 })
  assert.ok(!stats.best.some((item) => item.name === 'Big tray'))
})

test('rider week: money and trips land on the right Sapele day', async () => {
  const { dailySeries } = await import('../server/partnerToday.js')
  const week = dailySeries([
    { at: '2026-11-02T10:00:00Z', amountMinor: 80000 },
    { at: '2026-11-02T10:00:00Z', count: 1 },
    { at: '2026-11-01T23:30:00Z', amountMinor: 50000 }, // 00:30 on 2 Nov in Sapele
    { at: '2026-10-20T10:00:00Z', amountMinor: 99999 }, // older than a week: ignored
    { at: null, amountMinor: 5 },
  ], now)
  assert.equal(week.length, 7)
  assert.deepEqual(week[6], { day: '2026-11-02', label: 'Today', amountMinor: 130000, count: 1 })
  assert.equal(week.reduce((sum, day) => sum + day.amountMinor, 0), 130000)
})
