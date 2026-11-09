import assert from 'node:assert/strict'
import test from 'node:test'
import { chatWindow, cleanLocation, participantRole, QUICK_REPLIES, RATE_LIMIT, screenMessage, underRateLimit } from '../server/orderChat.js'
import { createOrderChatRouter } from '../server/orderChatRoutes.js'

const now = new Date('2026-11-09T12:00:00Z')
const hoursAgo = (hours) => new Date(now.getTime() - hours * 3_600_000)
const orderWith = (status, delivery = {}) => ({ id: 'o1', orderNumber: 'DS-1001', status, customerId: 'cust', restaurantId: 'r1', delivery: { riderId: 'rider1', status: 'ACCEPTED', pickedUpAt: null, deliveredAt: null, ...delivery } })

/* ------------------------------ rules ------------------------------ */
test('chat opens only once a rider has accepted the job', () => {
  assert.equal(chatWindow(orderWith('READY_FOR_PICKUP', { riderId: null, status: 'AVAILABLE' }), 'CUSTOMER_RIDER', now).reason, 'NO_RIDER')
  assert.equal(chatWindow(orderWith('READY_FOR_PICKUP', { riderId: 'rider1', status: 'REQUESTED' }), 'CUSTOMER_RIDER', now).canRead, false, 'an offer that is not accepted yet does not open it')
  assert.deepEqual(chatWindow(orderWith('RIDER_ASSIGNED'), 'CUSTOMER_RIDER', now), { canRead: true, canSend: true, reason: null })
  assert.equal(chatWindow(orderWith('RIDER_ASSIGNED'), 'STORE_RIDER', now).canSend, true)
})

test('store ↔ rider closes at pickup; customer ↔ rider closes at delivery; both stay readable for a day', () => {
  const pickedUp = orderWith('PICKED_UP', { status: 'PICKED_UP', pickedUpAt: hoursAgo(1) })
  assert.equal(chatWindow(pickedUp, 'CUSTOMER_RIDER', now).canSend, true)
  assert.deepEqual(chatWindow(pickedUp, 'STORE_RIDER', now), { canRead: true, canSend: false, reason: 'PICKED_UP' })
  const delivered = orderWith('DELIVERED', { status: 'DELIVERED', pickedUpAt: hoursAgo(2), deliveredAt: hoursAgo(1) })
  assert.deepEqual(chatWindow(delivered, 'CUSTOMER_RIDER', now), { canRead: true, canSend: false, reason: 'DELIVERED' })
  const old = orderWith('DELIVERED', { status: 'DELIVERED', pickedUpAt: hoursAgo(30), deliveredAt: hoursAgo(25) })
  assert.equal(chatWindow(old, 'CUSTOMER_RIDER', now).canRead, false)
  assert.equal(chatWindow({ ...orderWith('CANCELLED'), cancelledAt: hoursAgo(1) }, 'CUSTOMER_RIDER', now).reason, 'ORDER_CLOSED')
})

test('only the order’s own customer, rider and store team are in a chat (no customer ↔ store channel)', () => {
  const order = orderWith('RIDER_ASSIGNED')
  assert.equal(participantRole({ id: 'cust', role: 'CUSTOMER' }, order, 'CUSTOMER_RIDER'), 'CUSTOMER')
  assert.equal(participantRole({ id: 'cust', role: 'CUSTOMER' }, order, 'STORE_RIDER'), null)
  assert.equal(participantRole({ id: 'other', role: 'CUSTOMER' }, order, 'CUSTOMER_RIDER'), null)
  assert.equal(participantRole({ id: 'u9', role: 'RIDER', rider: { id: 'rider1' } }, order, 'STORE_RIDER'), 'RIDER')
  assert.equal(participantRole({ id: 'u8', role: 'RIDER', rider: { id: 'rider2' } }, order, 'CUSTOMER_RIDER'), null)
  assert.equal(participantRole({ id: 'staff', role: 'RESTAURANT' }, order, 'STORE_RIDER', { storeMemberIds: ['staff'] }), 'STORE')
  assert.equal(participantRole({ id: 'staff', role: 'RESTAURANT' }, order, 'CUSTOMER_RIDER', { storeMemberIds: ['staff'] }), null)
  assert.equal(participantRole({ id: 'admin', role: 'ADMIN' }, order, 'CUSTOMER_RIDER'), null, 'admins only read, through the admin view')
})

test('phone numbers, account numbers, emails and links are hidden; ordinary text is kept', () => {
  assert.deepEqual(screenMessage('I’m at the blue gate near the church'), { text: 'I’m at the blue gate near the church', hidden: [] })
  for (const [input, kind] of [['call me 08031234567', 'phone'], ['call +234 803 123 4567 now', 'phone'], ['pay to 0123456789 GTB', 'number'], ['mail me a@b.com', 'email'], ['see https://pay.example.com/x', 'link'], ['go to paystack.com', 'link']]) {
    const screened = screenMessage(input)
    assert.ok(screened.hidden.includes(kind), `${input} → ${kind}`)
    assert.match(screened.text, /•••/)
    assert.doesNotMatch(screened.text, /\d{7,}|@|https?:/)
  }
  assert.equal(screenMessage('x'.repeat(900)).text.length, 500)
  assert.equal(screenMessage('  lots   of   space ').text, 'lots of space')
})

test('rate limit, shared pins and quick replies', () => {
  const t = now.getTime()
  assert.equal(underRateLimit(Array.from({ length: RATE_LIMIT.messages - 1 }, () => t - 1000), t), true)
  assert.equal(underRateLimit(Array.from({ length: RATE_LIMIT.messages }, () => t - 1000), t), false)
  assert.equal(underRateLimit(Array.from({ length: 50 }, () => t - RATE_LIMIT.windowMs - 1), t), true, 'old messages don’t count')
  assert.deepEqual(cleanLocation({ latitude: 5.8941234567, longitude: 5.6766 }), { latitude: 5.894123, longitude: 5.6766 })
  assert.equal(cleanLocation({ latitude: 51.5, longitude: -0.12 }), null, 'outside Nigeria is refused')
  assert.equal(cleanLocation({ latitude: 'x', longitude: 1 }), null)
  for (const channel of Object.values(QUICK_REPLIES)) for (const replies of Object.values(channel)) for (const reply of replies) assert.deepEqual(screenMessage(reply).hidden, [], reply)
})

/* ------------------------------ routes (in-memory database) ------------------------------ */
function fakeDb(order) {
  const messages = []
  const notifications = []
  let seq = 0
  const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => {
    if (key === 'NOT') return !matches(row, value)
    if (key === 'OR') return value.some((part) => matches(row, part))
    if (value && typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value)) {
      if ('gte' in value) return row[key] >= value.gte
      if ('not' in value) return row[key] !== value.not
      if ('contains' in value) return String(row[key] || '').includes(value.contains)
      if ('startsWith' in value) return String(row[key] || '').startsWith(value.startsWith)
      if ('in' in value) return value.in.includes(row[key])
      return true
    }
    return row[key] === value
  })
  return {
    messages, notifications,
    order: { findFirst: async ({ where }) => (matches(order, where) ? order : null), findMany: async () => [order] },
    restaurantUser: { findMany: async ({ where }) => (where.restaurantId === order.restaurantId ? [{ userId: 'staff' }] : []) },
    user: { findMany: async () => [{ id: 'admin' }] },
    orderChatMessage: {
      findMany: async ({ where }) => messages.filter((row) => matches(row, where)),
      create: async ({ data }) => { const row = { id: `m${++seq}`, kind: 'TEXT', hidden: [], latitude: null, longitude: null, readAt: null, reportedAt: null, createdAt: new Date(), ...data }; messages.push(row); return row },
      updateMany: async ({ where, data }) => { const rows = messages.filter((row) => matches(row, where)); rows.forEach((row) => Object.assign(row, data)); return { count: rows.length } },
    },
    notification: {
      findFirst: async ({ where }) => notifications.find((row) => matches(row, where)) || null,
      create: async ({ data }) => { notifications.push({ readAt: null, ...data }); return data },
      createMany: async ({ data }) => { notifications.push(...data.map((row) => ({ readAt: null, ...row }))); return { count: data.length } },
      updateMany: async ({ where, data }) => { const rows = notifications.filter((row) => matches(row, where)); rows.forEach((row) => Object.assign(row, data)); return { count: rows.length } },
    },
  }
}
const people = {
  customer: { id: 'cust', role: 'CUSTOMER' },
  rider: { id: 'riderUser', role: 'RIDER', rider: { id: 'rider1' } },
  staff: { id: 'staff', role: 'RESTAURANT' },
  stranger: { id: 'x', role: 'CUSTOMER' },
}
// Calls a route through the router's own route table (works the same with real Express).
async function call(router, method, path, user, { body = {}, query = {} } = {}) {
  for (const layer of router.stack) {
    const route = layer.route
    if (!route?.methods[method.toLowerCase()]) continue
    const names = []
    const pattern = new RegExp(`^${route.path.replace(/:(\w+)/g, (_, name) => { names.push(name); return '([^/]+)' })}$`)
    const found = path.match(pattern)
    if (!found) continue
    const request = { params: Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(found[index + 1])])), body, query, user }
    const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this }, json(value) { this.body = value; return this } }
    const handlers = route.stack.map((item) => item.handle)
    const run = async (index) => { if (index < handlers.length) await handlers[index](request, response, () => run(index + 1)) }
    await run(0)
    return response
  }
  throw new Error(`no route ${method} ${path}`)
}
const pass = (_request, _response, next) => next()
const setup = (status = 'RIDER_ASSIGNED', delivery = {}) => {
  const order = { ...orderWith(status, delivery), customer: { id: 'cust', firstName: 'Ada' }, restaurant: { id: 'r1', name: 'Mama Put' }, delivery: { ...orderWith(status, delivery).delivery, rider: { userId: 'riderUser', user: { firstName: 'Tunde', lastName: 'B' } } } }
  const db = fakeDb(order)
  return { db, router: createOrderChatRouter({ prisma: db, requireUser: pass, requireAdmin: pass }) }
}

test('customer and rider can message each other; strangers and the store can’t read it', async () => {
  const { db, router } = setup()
  const first = await call(router, 'GET', '/order-chat/o1', people.customer, { query: { channel: 'CUSTOMER_RIDER' } })
  assert.equal(first.statusCode, 200)
  assert.equal(first.body.canSend, true)
  assert.equal(first.body.other.name, 'Tunde')
  assert.ok(first.body.quickReplies.length > 0)
  assert.equal((await call(router, 'POST', '/order-chat/o1', people.customer, { body: { channel: 'CUSTOMER_RIDER', body: 'Blue gate, call me 08031234567' } })).statusCode, 201)
  assert.equal(db.messages[0].body.includes('0803'), false, 'the number is never stored')
  assert.deepEqual(db.messages[0].hidden, ['phone'])
  assert.equal(db.notifications.length, 1)
  assert.equal(db.notifications[0].userId, 'riderUser')
  // A second message while the alert is unread doesn't add another alert.
  await call(router, 'POST', '/order-chat/DS-1001', people.customer, { body: { channel: 'CUSTOMER_RIDER', quickReply: 0 } })
  assert.equal(db.notifications.length, 1)
  assert.equal(db.messages[1].kind, 'QUICK')
  // The rider reads (by order number), which marks the customer's messages read.
  const seen = await call(router, 'GET', '/order-chat/DS-1001', people.rider, { query: { channel: 'CUSTOMER_RIDER' } })
  assert.equal(seen.body.messages.length, 2)
  assert.equal(seen.body.messages[0].mine, false)
  await call(router, 'POST', '/order-chat/DS-1001/read', people.rider, { body: { channel: 'CUSTOMER_RIDER' } })
  assert.ok(db.messages.every((message) => message.readAt))
  assert.ok(db.notifications[0].readAt, 'the rider’s chat alert is cleared too')
  assert.equal((await call(router, 'GET', '/order-chat/o1', people.stranger, { query: { channel: 'CUSTOMER_RIDER' } })).statusCode, 403)
  assert.equal((await call(router, 'GET', '/order-chat/o1', people.staff, { query: { channel: 'CUSTOMER_RIDER' } })).statusCode, 403)
  assert.equal((await call(router, 'GET', '/order-chat/nope', people.customer, { query: { channel: 'CUSTOMER_RIDER' } })).statusCode, 404)
})

test('store ↔ rider chat notifies the store team; closed chats refuse new messages', async () => {
  const { db, router } = setup()
  assert.equal((await call(router, 'POST', '/order-chat/DS-1001', people.rider, { body: { channel: 'STORE_RIDER', quickReply: 0 } })).statusCode, 201)
  assert.equal(db.notifications[0].userId, 'staff')
  assert.match(db.notifications[0].link, /^\/restaurant\/orders\?chat=/)
  const closed = setup('DELIVERED', { status: 'DELIVERED', pickedUpAt: new Date(Date.now() - 3_600_000), deliveredAt: new Date() })
  const refused = await call(closed.router, 'POST', '/order-chat/o1', people.customer, { body: { channel: 'CUSTOMER_RIDER', body: 'hello' } })
  assert.equal(refused.statusCode, 409)
  assert.equal(closed.db.messages.length, 0)
  assert.equal((await call(router, 'POST', '/order-chat/o1', people.customer, { body: { channel: 'CUSTOMER_RIDER', body: 'https://bad.link' } })).statusCode, 400, 'a message that is only a hidden link is not sent')
})

test('rate limit, location sharing, reports and the admin read view', async () => {
  const { db, router } = setup()
  for (let index = 0; index < RATE_LIMIT.messages; index += 1) await call(router, 'POST', '/order-chat/o1', people.customer, { body: { channel: 'CUSTOMER_RIDER', body: `msg ${index}` } })
  assert.equal((await call(router, 'POST', '/order-chat/o1', people.customer, { body: { channel: 'CUSTOMER_RIDER', body: 'one more' } })).statusCode, 429)
  const pin = await call(router, 'POST', '/order-chat/o1', people.rider, { body: { channel: 'CUSTOMER_RIDER', location: { latitude: 5.89, longitude: 5.68 } } })
  assert.equal(pin.statusCode, 201)
  assert.deepEqual(pin.body.message.location, { latitude: 5.89, longitude: 5.68 })
  assert.equal((await call(router, 'POST', '/order-chat/o1', people.rider, { body: { channel: 'CUSTOMER_RIDER', location: { latitude: 40, longitude: 5 } } })).statusCode, 400)
  // The customer can report the rider's message, not their own.
  const riderMessage = db.messages.find((message) => message.senderRole === 'RIDER')
  assert.equal((await call(router, 'POST', '/order-chat/o1/report', people.customer, { body: { channel: 'CUSTOMER_RIDER', messageId: db.messages[0].id, reason: 'Rude or abusive' } })).statusCode, 404)
  assert.equal((await call(router, 'POST', '/order-chat/o1/report', people.customer, { body: { channel: 'CUSTOMER_RIDER', messageId: riderMessage.id, reason: 'Rude or abusive' } })).statusCode, 200)
  assert.ok(riderMessage.reportedAt)
  assert.ok(db.notifications.some((row) => row.userId === 'admin' && row.type === 'SECURITY'))
  const admin = await call(router, 'GET', '/admin/chats', { id: 'admin', role: 'ADMIN' }, { query: { order: 'DS-1001' } })
  assert.equal(admin.body.messages.length, RATE_LIMIT.messages + 1)
  assert.equal(admin.body.messages.find((message) => message.id === riderMessage.id).reportReason, 'Rude or abusive')
})
