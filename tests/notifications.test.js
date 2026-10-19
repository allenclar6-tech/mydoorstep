import assert from 'node:assert/strict'
import { test } from 'node:test'
import { availableRiderUserIds, notifyAdmins, notifyUsers, sendWelcome, welcomeMessage } from '../server/notify.js'

const fakeDb = (overrides = {}) => {
  const written = []
  return {
    written,
    notification: {
      createMany: async ({ data }) => { written.push(...data); return { count: data.length } },
      findFirst: async ({ where }) => written.find((row) => row.userId === where.userId && row.title.startsWith(where.title.startsWith)) || null,
    },
    user: { findMany: async () => [{ id: 'admin1' }, { id: 'admin2' }] },
    rider: { findMany: async (query) => { overrides.riderQuery = query; return [{ userId: 'r1' }] } },
    ...overrides.db,
  }
}

test('notifyUsers de-duplicates recipients, trims text and only keeps in-app links', async () => {
  const db = fakeDb()
  const count = await notifyUsers(db, ['u1', 'u1', null, 'u2'], { type: 'ORDER', title: 'x'.repeat(300), body: 'Hello', link: 'https://evil.example' })
  assert.equal(count, 2)
  assert.equal(db.written[0].title.length, 120)
  assert.equal(db.written[0].link, null)
  await notifyUsers(db, ['u3'], { type: 'ORDER', title: 't', body: 'b', link: '//evil.example' })
  assert.equal(db.written.at(-1).link, null)
  await notifyUsers(db, ['u3'], { type: 'ORDER', title: 't', body: 'b', link: '/account/orders/1' })
  assert.equal(db.written.at(-1).link, '/account/orders/1')
  assert.equal(await notifyUsers(db, [], { type: 'ORDER', title: 't', body: 'b' }), 0)
})

test('notifyAdmins reaches every active admin', async () => {
  const db = fakeDb()
  assert.equal(await notifyAdmins(db, { type: 'PAYMENT', title: 'Bank transfer to confirm', body: 'b', link: '/admin/payments' }), 2)
  assert.deepEqual(db.written.map((row) => row.userId), ['admin1', 'admin2'])
})

test('rider alerts include business riders only for their own business', async () => {
  const holder = {}
  const db = fakeDb(holder)
  await availableRiderUserIds(db, { restaurantId: 'rest1' })
  assert.deepEqual(holder.riderQuery.where.OR, [{ network: 'DOORSTEP_POOL' }, { network: 'BUSINESS_OWNED', restaurantId: 'rest1' }])
  await availableRiderUserIds(db)
  assert.deepEqual(holder.riderQuery.where.OR, [{ network: 'DOORSTEP_POOL' }])
})

test('each account type gets its own welcome, sent only once', async () => {
  for (const role of ['CUSTOMER', 'RESTAURANT', 'RIDER', 'ADMIN']) assert.ok(welcomeMessage(role, { firstName: 'Ada', businessName: 'Mama Put' }).title.startsWith('Welcome to'), role)
  assert.match(welcomeMessage('RESTAURANT', { businessName: 'Fresh Mart', storeType: 'GROCERY' }).body, /product photos/)
  assert.equal(welcomeMessage('UNKNOWN'), null)
  const db = fakeDb()
  assert.equal(await sendWelcome(db, { id: 'u1', role: 'CUSTOMER', firstName: 'Ada' }), true)
  assert.equal(await sendWelcome(db, { id: 'u1', role: 'CUSTOMER', firstName: 'Ada' }), false)
  assert.equal(db.written.length, 1)
  assert.equal(db.written[0].title, 'Welcome to DOORSTEP, Ada!')
})
