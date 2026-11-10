import assert from 'node:assert/strict'
import test from 'node:test'
import { allowedPages, areaForPath, can, ROLE_AREAS, staffGuard, staffRoleOf, STAFF_ROLES } from '../server/staff.js'

const admin = (adminRole) => ({ id: 'a', role: 'ADMIN', adminRole })
const guard = (user, path) => {
  let status = 200
  let passed = false
  const response = { status(code) { status = code; return this }, json() { return this } }
  staffGuard({ user, baseUrl: '/api/admin', path: path.replace('/api/admin', '') }, response, () => { passed = true })
  return passed ? 200 : status
}

test('admins made before staff roles keep full access; non-admins are refused', () => {
  assert.equal(staffRoleOf(admin(null)), 'SUPER_ADMIN')
  assert.equal(staffRoleOf(admin('NONSENSE')), 'SUPER_ADMIN')
  assert.equal(staffRoleOf({ role: 'CUSTOMER' }), null)
  assert.equal(guard({ role: 'CUSTOMER' }, '/api/admin/summary'), 403)
  assert.equal(guard({ role: 'RIDER', rider: {} }, '/api/admin/books/summary'), 403)
})

test('each role reaches its own areas and nothing else (checked on the server)', () => {
  const cases = [
    ['FINANCE_ADMIN', '/api/admin/books/summary', 200], ['FINANCE_ADMIN', '/api/admin/finance/payouts', 200], ['FINANCE_ADMIN', '/api/admin/delivery-pricing', 403], ['FINANCE_ADMIN', '/api/admin/staff', 403],
    ['PRICING_MANAGER', '/api/admin/delivery-pricing', 200], ['PRICING_MANAGER', '/api/admin/merchant-deals', 200], ['PRICING_MANAGER', '/api/admin/locations/x', 200], ['PRICING_MANAGER', '/api/admin/finance/payouts', 403], ['PRICING_MANAGER', '/api/admin/dispatch', 403],
    ['DELIVERY_MANAGER', '/api/admin/delivery-quotes/q1/offer', 200], ['DELIVERY_MANAGER', '/api/admin/road-reports', 200], ['DELIVERY_MANAGER', '/api/admin/deliveries/active', 200], ['DELIVERY_MANAGER', '/api/admin/delivery-pricing', 403], ['DELIVERY_MANAGER', '/api/admin/books/journal.csv', 403],
    ['DISPATCH_OPERATOR', '/api/admin/dispatch', 200], ['DISPATCH_OPERATOR', '/api/admin/chats', 200], ['DISPATCH_OPERATOR', '/api/admin/delivery-quotes', 403], ['DISPATCH_OPERATOR', '/api/admin/refunds', 403],
    ['SUPER_ADMIN', '/api/admin/staff', 200], ['SUPER_ADMIN', '/api/admin/anything-new', 200],
  ]
  for (const [role, path, expected] of cases) assert.equal(guard(admin(role), path), expected, `${role} ${path}`)
  for (const role of STAFF_ROLES) assert.equal(guard(admin(role), '/api/admin/me'), 200, `${role} can always read their own access`)
})

test('unknown admin areas are Super admin only; similar names don’t leak', () => {
  assert.equal(areaForPath('/api/admin/brand-new-thing'), 'system')
  assert.equal(areaForPath('/api/admin/delivery-quotes-summary'), 'quotes')
  assert.equal(areaForPath('/api/admin/delivery-pricing/calculate'), 'pricing')
  assert.equal(areaForPath('/admin/books'), 'finance')
  for (const role of STAFF_ROLES.filter((value) => value !== 'SUPER_ADMIN')) assert.equal(can(admin(role), 'system'), false, role)
  assert.ok(Object.values(ROLE_AREAS).every((areas) => areas.includes('overview')))
})

test('menu pages follow the same rules', () => {
  const pages = allowedPages(admin('FINANCE_ADMIN'))
  assert.ok(pages.includes('/admin/books') && pages.includes('/admin/finance'))
  assert.ok(!pages.includes('/admin/pricing') && !pages.includes('/admin/staff') && !pages.includes('/admin/riders'))
  assert.ok(allowedPages(admin(null)).includes('/admin/staff'))
})

import { createStaffRouter } from '../server/staff.js'
async function call(router, method, path, user, body = {}) {
  for (const layer of router.stack) {
    const route = layer.route
    if (!route.methods[method.toLowerCase()]) continue
    const names = []
    const found = path.match(new RegExp(`^${route.path.replace(/:(\w+)/g, (_, name) => { names.push(name); return '([^/]+)' })}$`))
    if (!found) continue
    const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this }, json(value) { this.body = value; return this } }
    const request = { params: Object.fromEntries(names.map((name, index) => [name, found[index + 1]])), body, user }
    for (const handler of route.stack.map((item) => item.handle)) { let next = false; await handler(request, response, () => { next = true }); if (!next) break }
    return response
  }
  throw new Error('no route')
}
function fakeDb(users) {
  const audit = []
  const sessions = { deleted: [] }
  const db = {
    audit, sessions,
    user: {
      findMany: async ({ where }) => users.filter((user) => user.role === where.role && (!where.status || user.status === where.status)),
      findUnique: async ({ where }) => users.find((user) => (where.id && user.id === where.id) || (where.email && user.email === where.email)) || null,
      create: async ({ data }) => { const user = { id: `u${users.length + 1}`, createdAt: new Date(), passwordHash: null, ...data }; users.push(user); return user },
      update: async ({ where, data }) => Object.assign(users.find((user) => user.id === where.id), data),
    },
    session: { deleteMany: async ({ where }) => { sessions.deleted.push(where.userId); return { count: 1 } } },
    auditLog: { create: async ({ data }) => { audit.push(data); return data } },
  }
  db.$transaction = (work) => work(db)
  return db
}
const pass = (_request, _response, next) => next()

test('staff management: add with a role, never convert a customer account, always keep one Super admin', async () => {
  const users = [{ id: 'owner', role: 'ADMIN', adminRole: null, status: 'ACTIVE', email: 'owner@doorstep.ng', firstName: 'Ada', lastName: 'O' }, { id: 'c1', role: 'CUSTOMER', status: 'ACTIVE', email: 'buyer@gmail.com' }]
  const db = fakeDb(users)
  const router = createStaffRouter({ prisma: db, requireUser: pass })
  const owner = users[0]
  const added = await call(router, 'POST', '/admin/staff', owner, { firstName: 'Bola', email: 'Bola@Doorstep.ng', adminRole: 'FINANCE_ADMIN' })
  assert.equal(added.statusCode, 201)
  assert.equal(users.at(-1).email, 'bola@doorstep.ng')
  assert.equal(users.at(-1).role, 'ADMIN')
  assert.equal(users.at(-1).passwordHash, null, 'they set their own password')
  assert.equal(db.audit[0].action, 'STAFF_ADDED')
  assert.equal((await call(router, 'POST', '/admin/staff', owner, { firstName: 'X', email: 'buyer@gmail.com', adminRole: 'DISPATCH_OPERATOR' })).statusCode, 409)
  assert.equal(users[1].role, 'CUSTOMER')
  assert.equal((await call(router, 'PATCH', '/admin/staff/owner', owner, { adminRole: 'FINANCE_ADMIN' })).statusCode, 409, 'last Super admin can’t be demoted')
  assert.equal((await call(router, 'PATCH', '/admin/staff/owner', owner, { status: 'SUSPENDED' })).statusCode, 409)
  const bola = users.at(-1)
  assert.equal((await call(router, 'PATCH', `/admin/staff/${bola.id}`, owner, { status: 'SUSPENDED' })).statusCode, 200)
  assert.deepEqual(db.sessions.deleted, [bola.id], 'suspended staff are signed out at once')
  const me = await call(router, 'GET', '/admin/me', { role: 'ADMIN', adminRole: 'FINANCE_ADMIN' })
  assert.equal(me.body.roleName, 'Finance admin')
  assert.equal(me.body.owner, false)
})
