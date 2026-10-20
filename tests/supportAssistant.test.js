import assert from 'node:assert/strict'
import { test } from 'node:test'
import { supportReply } from '../server/supportAssistant.js'

const db = ({ stores = [], items = [] } = {}) => ({
  restaurant: { findMany: async ({ where }) => stores.filter((store) => !where.storeType || store.storeType === where.storeType) },
  menuItem: { findMany: async () => items },
})

test('the assistant only quotes real menu items and prices from the database', async () => {
  const reply = await supportReply(db({ items: [{ name: 'Beef suya', priceMinor: 250000, restaurant: { name: 'Mama Put' } }] }), 'where can I get suya?')
  assert.match(reply, /Beef suya at Mama Put \(₦2,500\)/)
  const none = await supportReply(db(), 'where can I get suya?')
  assert.doesNotMatch(none, /₦/, 'no prices when nothing matches')
})

test('the assistant says so when nothing is open, and hands over to a person', async () => {
  assert.match(await supportReply(db(), 'show me restaurants'), /No restaurants are taking orders/)
  assert.match(await supportReply(db({ stores: [{ name: 'Fresh Mart', storeType: 'GROCERY' }] }), 'any groceries?'), /Fresh Mart/)
  assert.match(await supportReply(db(), 'I was debited twice'), /team will also see this chat/)
  assert.match(await supportReply(db(), 'I was debited twice', { signedIn: false }), /Sign in/)
})

test('database errors fall back to a safe reply', async () => {
  const broken = { restaurant: { findMany: async () => { throw new Error('down') } }, menuItem: { findMany: async () => { throw new Error('down') } } }
  assert.match(await supportReply(broken, 'restaurants please'), /Thanks for your message/)
})

test('only plain files in your own upload folder count as yours', async () => {
  const { isOwnPrivateKey } = await import('../server/uploadService.js')
  assert.equal(isOwnPrivateKey('u1', 'private/users/u1/1729400000000-ab12cd34ef.png'), true)
  assert.equal(isOwnPrivateKey('u1', 'private/users/u1/../u2/1729400000000-ab12cd34ef.png'), false, 'path traversal into another user')
  assert.equal(isOwnPrivateKey('u1', 'private/users/u1/sub/file.png'), false)
  assert.equal(isOwnPrivateKey('u1', 'private/users/u2/1729400000000-ab12cd34ef.png'), false)
  assert.equal(isOwnPrivateKey('u1', 'private/documents/1729400000000-ab12cd34ef.pdf'), false)
  assert.equal(isOwnPrivateKey('u1', null), false)
})
