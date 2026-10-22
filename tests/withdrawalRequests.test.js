import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createWithdrawalRequest, markRequestPaid, sendRequestByPaystack, withdrawalOptions } from '../server/withdrawalRequests.js'
import { confirmPayout } from '../server/payoutEngine.js'
import { PAYOUT_SETTINGS_KEY, defaultPayoutSettings } from '../server/payoutSettings.js'

process.env.PAYSTACK_SECRET_KEY = 'sk_test_unit'
/** Just enough of Prisma, in memory, for the payout engine. */
function fakeDb({ entries = [], orders = [], accounts = [] } = {}) {
  const db = { entries: entries.map((entry, index) => ({ id: `e${index}`, payoutId: null, createdAt: new Date(0), ...entry })), payouts: [], orders, accounts, notifications: [], settings: new Map() }
  const matches = (row, where = {}) => Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') return condition.some((option) => matches(row, option))
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      if ('in' in condition) return condition.in.includes(row[key])
      if ('not' in condition) return row[key] !== condition.not
      if ('gte' in condition) return row[key] >= condition.gte
      if ('lt' in condition) return row[key] < condition.lt
      return false
    }
    return (row[key] ?? null) === condition
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
      findMany: async ({ where }) => db.payouts.filter((row) => matches(row, where)),
      count: async ({ where }) => db.payouts.filter((row) => matches(row, where)).length,
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

const account = { restaurantId: 'r1', paystackRecipientCode: 'RCP_1', status: 'ACTIVE', bankName: 'OPay', accountName: 'GREEN GROVE', accountLast4: '6789' }
const who = { kind: 'RESTAURANT', owner: { restaurantId: 'r1' }, name: 'Green Grove' }
const withdrawalsOn = (db, extra = {}) => db.settings.set(PAYOUT_SETTINGS_KEY, { ...structuredClone(defaultPayoutSettings), withdrawals: { enabled: true, minimumMinor: 100_000, feeMinor: 10_000, feePercent: 0, perDay: 3, ...extra } })
const credit = (amountMinor) => ({ party: 'RESTAURANT', restaurantId: 'r1', type: 'ADJUSTMENT', amountMinor, status: 'DUE', description: 'Admin credit', dedupeKey: `x${amountMinor}` })

test('without Paystack Transfers, a partner can still request a withdrawal and the money is set aside at once', async () => {
  delete process.env.PAYSTACK_TRANSFERS_ENABLED
  const db = fakeDb({ entries: [credit(442_000)], accounts: [account] })
  assert.equal((await withdrawalOptions(db, who)).mode, 'REQUEST', 'partners can always ask, even before cash-outs are switched on')
  withdrawalsOn(db)
  const options = await withdrawalOptions(db, who)
  assert.equal(options.mode, 'REQUEST')
  assert.equal(options.blocked, null)
  assert.equal(options.netMinor, 432_000)
  const payout = await createWithdrawalRequest(db, who, { actorId: 'owner1' })
  assert.equal(payout.status, 'REQUESTED')
  assert.equal(payout.amountMinor, 432_000)
  assert.equal(payout.feeMinor, 10_000)
  assert.ok(db.entries.filter((entry) => entry.restaurantId === 'r1' && entry.type === 'ADJUSTMENT').every((entry) => entry.status === 'PAYING'), 'reserved so it can’t be withdrawn twice')
  assert.equal((await withdrawalOptions(db, who)).blocked, 'OPEN_REQUEST')
  await assert.rejects(createWithdrawalRequest(db, who, { actorId: 'owner1' }), (error) => error.code === 'OPEN_REQUEST')
  assert.ok(db.notifications.some((row) => /Withdrawal request/.test(row.title)), 'admins are told')
})

test('the admin records the bank payment, the partner confirms, and the fee becomes DOORSTEP income', async () => {
  const db = fakeDb({ entries: [credit(300_000)], accounts: [account] })
  withdrawalsOn(db)
  const payout = await createWithdrawalRequest(db, who, { actorId: 'owner1' })
  const sent = await markRequestPaid(db, payout.id, { bankReference: 'OPAY-123', actorId: 'admin1' })
  assert.equal(sent.status, 'AWAITING_CONFIRMATION')
  assert.equal(await markRequestPaid(db, payout.id, { bankReference: 'again', actorId: 'admin1' }), null, 'handled once only')
  await confirmPayout(db, payout.id, { userId: 'owner1' })
  assert.equal(db.payouts[0].status, 'PAID')
  assert.ok(db.entries.filter((entry) => entry.payoutId === payout.id && entry.party === 'RESTAURANT').every((entry) => entry.status === 'PAID'))
  assert.equal(db.entries.find((entry) => entry.party === 'PLATFORM').status, 'RETAINED')
})

test('below the minimum, with no bank account, or past the daily limit, a withdrawal is refused with a reason', async () => {
  const small = fakeDb({ entries: [credit(50_000)], accounts: [account] })
  withdrawalsOn(small)
  assert.equal((await withdrawalOptions(small, who)).blocked, 'BELOW_MINIMUM')
  const noBank = fakeDb({ entries: [credit(500_000)], accounts: [] })
  withdrawalsOn(noBank)
  assert.equal((await withdrawalOptions(noBank, who)).blocked, 'NO_ACCOUNT')
  const limited = fakeDb({ entries: [credit(500_000)], accounts: [account] })
  withdrawalsOn(limited, { perDay: 1 })
  limited.payouts.push({ id: 'old', restaurantId: 'r1', source: 'WITHDRAWAL', status: 'PAID', createdAt: new Date() })
  assert.equal((await withdrawalOptions(limited, who)).blocked, 'DAILY_LIMIT')
})

test('with Paystack Transfers and cash-out on, the partner withdraws instantly, and an admin can send a request by Paystack', async () => {
  process.env.PAYSTACK_TRANSFERS_ENABLED = 'true'
  const db = fakeDb({ entries: [credit(300_000)], accounts: [account] })
  withdrawalsOn(db)
  assert.equal((await withdrawalOptions(db, who)).mode, 'INSTANT')
  delete process.env.PAYSTACK_TRANSFERS_ENABLED
  const payout = await createWithdrawalRequest(db, who, { actorId: 'owner1' })
  process.env.PAYSTACK_TRANSFERS_ENABLED = 'true'
  const calls = []
  const fetchImpl = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({ status: true, data: { status: 'success', transfer_code: 'TRF_1' } }) } }
  const result = await sendRequestByPaystack(db, payout.id, { actorId: 'admin1', fetchImpl })
  assert.equal(result.status, 'PAID')
  assert.equal(calls[0].body.amount, 290_000)
  assert.equal(calls[0].body.recipient, 'RCP_1')
  delete process.env.PAYSTACK_TRANSFERS_ENABLED
})
