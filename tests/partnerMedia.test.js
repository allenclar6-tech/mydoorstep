import assert from 'node:assert/strict'
import { test } from 'node:test'
import express from 'express'
import request from 'supertest'
import sharp from 'sharp'
import { preparePartnerImage, registerPartnerMedia, menuMediaUrl, publicMenuItems, publicRestaurantImage } from '../server/partnerMedia.js'
import { readPrivateDocument, removePrivateDocument } from '../server/uploadService.js'

test('partner images reject invalid media and decode real raster images', async () => {
  await assert.rejects(preparePartnerImage(null), { code: 'IMAGE_REQUIRED' })
  await assert.rejects(preparePartnerImage({ mimetype: 'image/svg+xml', buffer: Buffer.from('<svg/>') }), { code: 'UNSUPPORTED_IMAGE_TYPE' })
  await assert.rejects(preparePartnerImage({ mimetype: 'image/png', buffer: Buffer.from('not an image') }), { code: 'INVALID_IMAGE' })
  const buffer = await sharp({ create: { width: 1800, height: 1000, channels: 3, background: '#ffcc00' } }).jpeg().toBuffer()
  const output = await preparePartnerImage({ mimetype: 'image/jpeg', buffer })
  const metadata = await sharp(output).metadata()
  assert.equal(metadata.format, 'png')
  assert.equal(metadata.width, 1600)
  assert.equal(metadata.exif, undefined)
})

test('menu media URLs never expose private file keys', () => {
  assert.equal(menuMediaUrl({ id: 'item', imageUrl: 'private/restaurant-media/store/test.png' }), '/api/media/menu/item')
  assert.equal(menuMediaUrl({ id: 'item', imageUrl: 'https://example.com/photo.jpg' }), 'https://example.com/photo.jpg')
})

test('store images use the owner logo without exposing private storage keys', () => {
  assert.equal(publicRestaurantImage({ id: 'store', users: [{ userId: 'owner', user: { profileImageKey: 'private/users/owner/logo.png' } }] }), '/api/media/restaurants/store/logo')
  assert.equal(publicRestaurantImage({ id: 'store', coverImageUrl: 'https://example.com/cover.jpg', users: [{ userId: 'owner', user: { profileImageKey: 'private/users/other/logo.png' } }] }), 'https://example.com/cover.jpg')
  assert.equal(publicRestaurantImage({ id: 'store' }), null)
})

test('public menus include uncategorized partner items and their uploaded photo', () => {
  const items = publicMenuItems({
    categories: [{ name: 'Meals', items: [{ id: 'categorized', name: 'Rice', priceMinor: 150000 }] }],
    menuItems: [{ id: 'new-item', name: 'Pepper turkey', priceMinor: 520000, imageUrl: 'private/restaurant-media/store/photo.png' }],
  })
  assert.deepEqual(items.map(item => item.id), ['categorized', 'new-item'])
  assert.equal(items[1].image, '/api/media/menu/new-item')
  assert.equal(items[1].price, 5200)
  assert.equal(items[1].category, 'Menu')
})

test('partner uploads enforce role, ownership, persistence and public visibility', async () => {
  const keys = []
  const item = { id: 'item', available: true, restaurant: { status: 'APPROVED' }, imageUrl: null }
  const prisma = {
    restaurantUser: { findFirst: async () => ({ restaurantId: 'store' }) },
    menuItem: {
      findFirst: async ({ where }) => where.id === 'item' ? { ...item } : null,
      findUnique: async () => item,
      updateMany: async ({ data }) => { item.imageUrl = data.imageUrl; keys.push(data.imageUrl); return { count: 1 } },
    },
    user: { findUnique: async () => ({ profileImageKey: null }), update: async ({ data }) => { keys.push(data.profileImageKey); return {} } },
  }
  const app = express()
  registerPartnerMedia(app, { prisma, requireUser: (req, res, next) => {
    if (!req.headers.authorization) return res.status(401).json({ error: 'AUTH_REQUIRED' })
    req.user = { id: 'partner-test', role: req.headers.authorization === 'customer' ? 'CUSTOMER' : 'RESTAURANT' }; next()
  } })
  const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#117744' } }).png().toBuffer()
  try {
    assert.equal((await request(app).post('/api/restaurant/logo')).status, 401)
    assert.equal((await request(app).post('/api/restaurant/logo').set('Authorization', 'customer')).status, 403)
    assert.equal((await request(app).post('/api/restaurant/menu/other/image').set('Authorization', 'partner').attach('image', image, 'photo.png')).status, 404)
    assert.equal((await request(app).post('/api/restaurant/logo').set('Authorization', 'partner')).status, 400)
    const oversized = await request(app).post('/api/restaurant/logo').set('Authorization', 'partner').attach('image', Buffer.alloc(5 * 1024 * 1024 + 1), 'large.png')
    assert.equal(oversized.status, 400)
    assert.equal(oversized.body.error, 'IMAGE_TOO_LARGE')
    const menu = await request(app).post('/api/restaurant/menu/item/image').set('Authorization', 'partner').attach('image', image, 'photo.png')
    assert.equal(menu.status, 200)
    assert.equal(menu.body.imageUrl, '/api/media/menu/item')
    assert.equal((await request(app).get('/api/media/menu/item')).status, 200)
    item.available = false
    assert.equal((await request(app).get('/api/media/menu/item')).status, 404)
    assert.equal((await request(app).get('/api/restaurant/menu/item/image').set('Authorization', 'partner')).status, 200)
    item.available = true
    item.restaurant.status = 'PENDING_APPROVAL'
    assert.equal((await request(app).get('/api/media/menu/item')).status, 404)
    const logo = await request(app).post('/api/restaurant/logo').set('Authorization', 'partner').attach('image', image, 'logo.png')
    assert.equal(logo.status, 200)
    assert.ok(keys.at(-1).startsWith('private/users/partner-test/'))
    const logoKey = keys.at(-1)
    prisma.restaurant = { findFirst: async ({ where, select }) => {
      assert.equal(where.status, 'APPROVED')
      assert.equal(select.users.where.role, 'OWNER')
      return { users: [{ userId: 'partner-test', user: { profileImageKey: logoKey } }] }
    } }
    const publicLogo = await request(app).get('/api/media/restaurants/store/logo')
    assert.equal(publicLogo.status, 200)
    assert.match(publicLogo.headers['content-type'], /image\/png/)
    prisma.restaurant.findFirst = async () => null
    assert.equal((await request(app).get('/api/media/restaurants/store/logo')).status, 404)
    prisma.restaurant.findFirst = async () => ({ users: [{ userId: 'other', user: { profileImageKey: logoKey } }] })
    assert.equal((await request(app).get('/api/media/restaurants/store/logo')).status, 404)
    let failedKey
    prisma.menuItem.updateMany = async ({ data }) => { failedKey = data.imageUrl; throw new Error('Synthetic database failure') }
    const failed = await request(app).post('/api/restaurant/menu/item/image').set('Authorization', 'partner').attach('image', image, 'photo.png')
    assert.equal(failed.status, 503)
    assert.equal(failed.body.error, 'MEDIA_SERVICE_UNAVAILABLE')
    assert.ok(failedKey)
    await assert.rejects(readPrivateDocument(failedKey), { code: 'PRIVATE_DOCUMENT_NOT_FOUND' })
    prisma.restaurantUser.findFirst = async () => null
    assert.equal((await request(app).post('/api/restaurant/logo').set('Authorization', 'partner').attach('image', image, 'logo.png')).status, 403)
  } finally { for (const key of keys) await removePrivateDocument(key) }
})
