import test from 'node:test'
import assert from 'node:assert/strict'
import { authorName, itemStats, publicReview, reviewMentionsItem } from '../server/reviewsPublic.js'

const review = {
  id: 'r1', rating: 5, body: 'Hot and fast', createdAt: '2026-11-01T10:00:00Z',
  user: { firstName: 'Ejiro', lastName: 'Eyedo' },
  order: { items: [{ menuItemId: 'm1', nameSnapshot: 'Jollof rice', quantity: 2 }, { menuItemId: 'm2', nameSnapshot: 'Chapman', quantity: 1 }] },
  itemFeedback: [{ menuItemId: 'm1', name: 'Jollof rice', liked: true }, { menuItemId: 'm2', name: 'Chapman', liked: false }, { junk: true }],
}

test('reviewer names never show the full surname', () => {
  assert.equal(authorName({ firstName: 'Ejiro', lastName: 'Eyedo' }), 'Ejiro E.')
  assert.equal(authorName({ firstName: 'Tunde' }), 'Tunde')
  assert.equal(authorName(null), 'DOORSTEP customer')
})

test('a public review shows thumbs, what was ordered and per-item thumbs, nothing private', () => {
  const shown = publicReview(review)
  assert.equal(shown.liked, true)
  assert.equal(shown.author, 'Ejiro E.')
  assert.deepEqual(shown.items.map((item) => item.name), ['Jollof rice', 'Chapman'])
  assert.equal(shown.itemFeedback.length, 2)
  assert.equal(JSON.stringify(shown).includes('Eyedo'), false)
  assert.equal(publicReview({ ...review, rating: 2 }).liked, false)
})

test('item stats count thumbs per item; reviews mention items they rated or ordered', () => {
  const stats = itemStats([review, { ...review, itemFeedback: [{ menuItemId: 'm1', liked: true }] }, { ...review, itemFeedback: null }])
  assert.deepEqual(stats, { m1: { liked: 2, total: 2 }, m2: { liked: 0, total: 1 } })
  assert.equal(reviewMentionsItem(review, 'm2'), true)
  assert.equal(reviewMentionsItem(review, 'm9'), false)
})
