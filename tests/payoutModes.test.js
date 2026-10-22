import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyTransferResult, availableBalance, createPayout, entryAvailable, payParty, runPayoutSweep } from '../server/payoutEngine.js'
import { defaultPayoutSettings, lastScheduledMoment, nextScheduledMoment, payoutSettingsSchema, startOfLagosDay, withdrawalFee } from '../server/payoutSettings.js'
import { orderShares, withBusinessCommission } from '../server/financeService.js'

process.env.PAYSTACK_SECRET_KEY = 'sk_test_unit'
const HOUR = 3_600_000

/** Just enough of Prisma, in memory, for the payout engine. */
function fakeDb({ entries = [], orders = [], accounts = [] } = {}) {
  const db = { entries: entries.map((entry, index) => ({ id: `e${index}`, payoutId: null, createdAt: new Date(0), ...entry })), payouts: [], orders, accounts, notifications: [], settings: new Map() }
  const matches = (row, where = {}) => Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') return condition.some((option) => matches(row, option))
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      if ('in' in condition) return condition.in.includes(row[key])
      if ('not' in condition) return row[key] !== condition.not
      if ('gte' in condition) return row[key] >= condition.gte
      return false
    }
    return row[key] === condition
  })
  const update = (rows, where, data) => { const hit = rows.filter((row) => matches(row, where)); hit.forEach((row) => Object.assign(row, data)); return { count: hit.length } }
  Object.assign(db, {
    $transaction: (fn) => fn(db),
    ledgerEntry: {
      findMany: async ({ where }) => db.entries.filter((row) => matches(row, where)),
      updateMany: async ({ where, data }) => update(db.entries, where, data),
      createMany: async ({ data }) => { data.forEach((row) => db.entries.push({ id: `e${db.entries.length}`, createdAt: new Date(), ...row })); return { count: data.length } },
      groupBy: async ({ by, where }) => {
        const groups = new Map()
        for (const row of db.entries.filter((entry) => matches(entry, where))) { const key = row[by[0]]; groups.set(key, (groups.get(key) || 0) + row.amountMinor) }
        return [...groups].map(([key, sum]) => ({ [by[0]]: key, _sum: { amountMinor: sum } }))
      },
    },
    payout: {
      create: async ({ data }) => { const row = { id: `p${db.payouts.length}`, createdAt: new Date(), ...data }; db.payouts.push(row); return row },
      findUnique: async ({ where }) => db.payouts.find((row) => matches(row, where)) || null,
      findFirst: async ({ where }) => db.payouts.find((row) => matches(row, where)) || null,
      update: async ({ where, data }) => Object.assign(db.payouts.find((row) => row.id === where.id), data),
      updateMany: async ({ where, data }) => update(db.payouts, where, data),
    },
    order: { findMany: async ({ where }) => db.orders.filter((row) => matches(row, where)) },
    payoutAccount: { findFirst: async ({ where }) => db.accounts.find((row) => matches(row, where)) || null },
    auditLog: { create: async () => ({}) },
    notification: { createMany: async ({ data }) => { db.notifications.push(...data); return { count: data.length } } },
    user: { findMany: async () => [{ id: 'admin1' }] },
    rider: { findUnique: async () => ({ userId: 'riderUser' }) },
    restaurantUser: { findMany: async () => [{ userId: 'owner1' }] },
    platformSetting: {
      findUnique: async ({ where }) => db.settings.has(where.key) ? { value: db.settings.get(where.key) } : null,
      upsert: async ({ where, create }) => { db.settings.set(where.key, create.value); return create },
    },
  })
  return db
}
const account = { restaurantId: 'r1', paystackRecipientCode: 'RCP_1', status: 'ACTIVE', bankName: 'GTBank', accountName: 'MAMA PUT', accountLast4: '6789' }
const paystack = (status = 'success') => { const calls = []; return { calls, fetchImpl: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({ status: true, data: { status, transfer_code: 'TRF_1' } }) } } } }

test('order money clears only once the order is delivered and the hold has passed', () => {
  const now = new Date('2026-10-22T12:00:00Z')
  const share = { amountMinor: 500_000, orderId: 'o1', createdAt: new Date(now - 30 * HOUR) }
  assert.equal(entryAvailable(share, 'DELIVERED', 24, now), true)
  assert.equal(entryAvailable(share, 'PREPARING', 24, now), false, 'never paid before the food arrives')
  assert.equal(entryAvailable({ ...share, createdAt: new Date(now - 2 * HOUR) }, 'DELIVERED', 24, now), false, 'still inside the complaint window')
  assert.equal(entryAvailable({ amountMinor: -20_000, orderId: 'o2', createdAt: now }, 'PREPARING', 24, now), true, 'deductions always count')
  assert.equal(entryAvailable({ amountMinor: 10_000, createdAt: now }, undefined, 24, now), true, 'admin credits are immediate')
  assert.equal(entryAvailable({ amountMinor: 10_000, parcelBookingId: 'b1', createdAt: new Date(now - HOUR) }, undefined, 0, now), true)
})

test('schedules follow Lagos time, and a missed run is caught up', () => {
  const weekly = { frequency: 'WEEKLY', weekday: 1, hour: 10 } // Monday 10:00 WAT = 09:00 UTC
  assert.equal(lastScheduledMoment(new Date('2026-10-21T15:00:00Z'), weekly).toISOString(), '2026-10-19T09:00:00.000Z') // Wednesday → last Monday
  assert.equal(lastScheduledMoment(new Date('2026-10-19T08:59:00Z'), weekly).toISOString(), '2026-10-12T09:00:00.000Z') // a minute early → week before
  assert.equal(nextScheduledMoment(new Date('2026-10-21T15:00:00Z'), weekly).toISOString(), '2026-10-26T09:00:00.000Z')
  const daily = { frequency: 'DAILY', weekday: 0, hour: 0 } // midnight WAT = 23:00 UTC the day before
  assert.equal(lastScheduledMoment(new Date('2026-10-21T22:30:00Z'), daily).toISOString(), '2026-10-20T23:00:00.000Z')
  assert.equal(startOfLagosDay(new Date('2026-10-21T23:30:00Z')).toISOString(), '2026-10-21T23:00:00.000Z')
})

test('payout settings default to manual, and fees and per-business commission add up', () => {
  assert.equal(payoutSettingsSchema.safeParse(defaultPayoutSettings).success, true)
  assert.equal(defaultPayoutSettings.businesses.mode, 'MANUAL', 'nothing moves automatically until an admin chooses it')
  assert.equal(withdrawalFee(1_000_000, { feeMinor: 10_000, feePercent: 1.5 }), 25_000)
  const settings = { commission: { doorstepRiderPercent: 15, ownRiderPercent: 10 } }
  assert.equal(withBusinessCommission(settings, {}), settings)
  const custom = withBusinessCommission(settings, { commissionDoorstepRiderPercent: '12.5', commissionOwnRiderPercent: null })
  assert.deepEqual(custom.commission, { doorstepRiderPercent: 12.5, ownRiderPercent: 10 })
  assert.equal(orderShares({ subtotalMinor: 1_000_000, deliveryFeeMinor: 80_000, serviceFeeMinor: 30_000, totalMinor: 1_110_000 }, 'DOORSTEP_RIDER', custom).commissionMinor, 125_000)
})

test('a cash-out pays the cleared balance minus the fee, and DOORSTEP keeps the fee', async () => {
  process.env.PAYSTACK_TRANSFERS_ENABLED = 'true'
  const now = new Date()
  const db = fakeDb({
    entries: [
      { party: 'RESTAURANT', restaurantId: 'r1', orderId: 'o1', amountMinor: 800_000, status: 'DUE', createdAt: new Date(now - 30 * HOUR) },
      { party: 'RESTAURANT', restaurantId: 'r1', orderId: 'o2', amountMinor: 400_000, status: 'DUE', createdAt: new Date(now - 30 * HOUR) },
    ],
    orders: [{ id: 'o1', status: 'DELIVERED' }, { id: 'o2', status: 'PREPARING' }],
    accounts: [account],
  })
  const balance = await availableBalance(db, { party: 'RESTAURANT', restaurantId: 'r1' }, 24, now)
  assert.deepEqual([balance.availableMinor, balance.heldMinor], [800_000, 400_000])
  const transfer = paystack('success')
  const { payout } = await createPayout(db, { party: 'RESTAURANT', restaurantId: 'r1', entryIds: balance.entryIds, method: 'PAYSTACK_TRANSFER', source: 'WITHDRAWAL', feeMinor: 10_000, account, fetchImpl: transfer.fetchImpl })
  assert.equal(transfer.calls[0].body.amount, 790_000, 'the fee is taken before the transfer')
  assert.equal(payout.status, 'PAID')
  assert.equal(db.entries.find((entry) => entry.orderId === 'o2').status, 'DUE', 'undelivered order stays owed')
  assert.equal(db.entries.find((entry) => entry.party === 'PLATFORM').status, 'RETAINED')
  assert.equal(db.entries.filter((entry) => entry.party === 'RESTAURANT' && entry.status === 'PAID').reduce((sum, entry) => sum + entry.amountMinor, 0), 790_000)
})

test('a failed cash-out refunds the fee and puts the money back in the balance', async () => {
  process.env.PAYSTACK_TRANSFERS_ENABLED = 'true'
  const db = fakeDb({ entries: [{ party: 'RIDER', riderId: 'd1', parcelBookingId: 'b1', amountMinor: 300_000, status: 'DUE' }], accounts: [{ ...account, restaurantId: undefined, riderId: 'd1' }] })
  const { payout } = await createPayout(db, { party: 'RIDER', riderId: 'd1', method: 'PAYSTACK_TRANSFER', source: 'WITHDRAWAL', feeMinor: 10_000, account: db.accounts[0], fetchImpl: paystack('pending').fetchImpl })
  assert.equal(payout.status, 'PROCESSING')
  await applyTransferResult(db, payout.reference, 'failed', 'Account blocked')
  assert.equal(db.entries[0].status, 'DUE')
  assert.equal(db.entries[0].payoutId, null)
  assert.ok(db.entries.filter((entry) => entry.type === 'WITHDRAWAL_FEE').every((entry) => entry.status === 'VOID'))
  assert.ok(db.notifications.some((note) => note.userId === 'riderUser' && /no fee was charged/.test(note.body)))
})

test('the same money is never paid twice, and automatic payouts back off after a failure', async () => {
  process.env.PAYSTACK_TRANSFERS_ENABLED = 'true'
  const db = fakeDb({ entries: [{ party: 'RESTAURANT', restaurantId: 'r1', amountMinor: 500_000, status: 'DUE' }], accounts: [account] })
  await createPayout(db, { party: 'RESTAURANT', restaurantId: 'r1', method: 'PAYSTACK_TRANSFER', account, fetchImpl: paystack('pending').fetchImpl })
  await assert.rejects(createPayout(db, { party: 'RESTAURANT', restaurantId: 'r1', method: 'PAYSTACK_TRANSFER', account, fetchImpl: paystack().fetchImpl }), { code: 'NOTHING_TO_PAY' })
  db.entries.push({ id: 'late', party: 'RESTAURANT', restaurantId: 'r1', amountMinor: 200_000, status: 'DUE', createdAt: new Date(0) })
  const summary = await payParty(db, 'RESTAURANT', { holdHours: 0, minimumMinor: 100, source: 'AUTOMATIC', fetchImpl: paystack().fetchImpl })
  assert.deepEqual(summary.skipped.map((entry) => entry.reason), ['RECENT_OR_PENDING_PAYOUT'], 'waits for the transfer in flight')
})

test('the sweep does nothing while transfers are off or payouts are manual', async () => {
  process.env.PAYSTACK_TRANSFERS_ENABLED = 'false'
  assert.deepEqual(await runPayoutSweep(fakeDb()), { skipped: 'TRANSFERS_OFF' })
  process.env.PAYSTACK_TRANSFERS_ENABLED = 'true'
  const db = fakeDb({ entries: [{ party: 'RESTAURANT', restaurantId: 'r1', amountMinor: 500_000, status: 'DUE' }], accounts: [account] })
  assert.deepEqual(await runPayoutSweep(db), {})
  assert.equal(db.payouts.length, 0)
  db.settings.set('payout_settings', { ...defaultPayoutSettings, businesses: { ...defaultPayoutSettings.businesses, mode: 'AUTOMATIC', holdHours: 0 } })
  const transfer = paystack()
  const result = await runPayoutSweep(db, { fetchImpl: transfer.fetchImpl })
  assert.equal(result.RESTAURANT.paid, 1)
  assert.equal(transfer.calls[0].body.amount, 500_000)
})
