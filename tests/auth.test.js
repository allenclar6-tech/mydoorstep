import assert from 'node:assert/strict'
import { test } from 'node:test'
import { accountPathFor, loginPathFor, signOut } from '../src/services/authService.js'

test('partner and rider account links never target the customer profile', () => {
  assert.equal(accountPathFor('RESTAURANT'), '/restaurant/profile')
  assert.equal(accountPathFor('RIDER'), '/rider/verification')
  assert.equal(accountPathFor('CUSTOMER'), '/account')
  assert.equal(accountPathFor(null), '/account')
})

test('account and portal routes select the correct login page', () => {
  for (const [path, role, expected] of [
    ['/account/profile', 'CUSTOMER', '/login'],
    ['/restaurant/orders', null, '/partner/login'],
    ['/partners/groceries/register', null, '/partner/login'],
    ['/rider/dashboard', null, '/rider/login'],
    ['/riders/register', null, '/rider/login'],
    ['/account', 'RESTAURANT', '/partner/login'],
    ['/', 'RIDER', '/rider/login'],
    ['/admin/dashboard', null, '/admin/login'],
  ]) assert.equal(loginPathFor(path, role), expected)
})

test('logout revokes the appropriate session, clears storage and replaces the URL', async (t) => {
  for (const scenario of [
    { path: '/account', role: 'CUSTOMER', status: 204, expected: '/login' },
    { path: '/restaurant/profile', role: 'RESTAURANT', status: 204, expected: '/partner/login' },
    { path: '/rider/dashboard', role: 'RIDER', status: 401, expected: '/rider/login' },
    { path: '/admin/dashboard', admin: true, status: 204, expected: '/admin/login' },
    { path: '/account', status: 503, expected: '/login?logout=local' },
    { path: '/account', offline: true, expected: '/login?logout=local' },
    { path: '/account', missing: true, expected: '/login' },
  ]) {
    await t.test(`${scenario.path} ${scenario.status || (scenario.offline ? 'offline' : 'no session')}`, async (t) => {
      const values = new Map([['doorstep-token', 'test-public-session'], ['doorstep-admin-token', 'test-admin-session'], ['doorstep-role', scenario.role || 'CUSTOMER']])
      if (scenario.missing) values.delete('doorstep-token')
      let destination
      let calls = 0
      t.mock.method(console, 'warn', () => {})
      t.mock.method(globalThis, 'fetch', async (url, options) => {
        calls++
        assert.equal(url, '/api/auth/logout')
        assert.equal(options.method, 'POST')
        assert.equal(options.headers.Authorization, `Bearer test-${scenario.admin ? 'admin' : 'public'}-session`)
        if (scenario.offline) throw new TypeError('offline')
        return { ok: scenario.status === 204, status: scenario.status }
      })
      const descriptors = ['localStorage', 'window'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
      t.after(() => {
        for (const [key, descriptor] of descriptors) {
          if (descriptor) Object.defineProperty(globalThis, key, descriptor)
          else delete globalThis[key]
        }
      })
      Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (key) => values.get(key), removeItem: (key) => values.delete(key) }, configurable: true })
      Object.defineProperty(globalThis, 'window', { value: { location: { pathname: scenario.path, replace: (url) => { destination = url } } }, configurable: true })
      const options = { apiBase: '', admin: scenario.admin }
      const first = signOut(options)
      assert.equal(signOut(options), first)
      await first
      assert.equal(destination, scenario.expected)
      assert.equal(values.has(scenario.admin ? 'doorstep-admin-token' : 'doorstep-token'), false)
      assert.equal(values.has(scenario.admin ? 'doorstep-token' : 'doorstep-admin-token'), true)
      assert.equal(calls, scenario.missing ? 0 : 1)
      t.mock.restoreAll()
    })
  }
})
