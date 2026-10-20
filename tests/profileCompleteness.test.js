import assert from 'node:assert/strict'
import { test } from 'node:test'
import { customerChecklist, partnerChecklist, riderChecklist, summarise } from '../server/profileCompleteness.js'

const sum = (items) => items.reduce((total, entry) => total + entry.weight, 0)

test('every role checklist is weighted to exactly 100', () => {
  assert.equal(sum(customerChecklist({ user: {}, addressCount: 0 })), 100)
  assert.equal(sum(riderChecklist({ user: {}, rider: null })), 100)
  assert.equal(sum(partnerChecklist({ user: {}, restaurant: null, menuItemCount: 0 })), 100)
})

test('a brand-new customer starts low and reaches 100% only when every item is really done', () => {
  const fresh = summarise(customerChecklist({ user: { firstName: 'Ada', lastName: 'Obi', email: 'a@b.ng' }, addressCount: 0 }))
  assert.equal(fresh.percent, 15)
  assert.equal(fresh.next.key, 'email')
  const done = summarise(customerChecklist({ user: { firstName: 'Ada', lastName: 'Obi', emailVerifiedAt: new Date(), phone: '+2348000000000', phoneVerifiedAt: new Date(), profileImageKey: 'private/x.jpg', deliveryNotes: 'Blue gate' }, addressCount: 1 }))
  assert.equal(done.percent, 100)
  assert.equal(done.complete, true)
  assert.equal(done.next, null)
  const unverifiedPhone = summarise(customerChecklist({ user: { firstName: 'Ada', lastName: 'Obi', emailVerifiedAt: new Date(), phone: '+2348000000000', phoneVerifiedAt: null }, addressCount: 1 }))
  assert.equal(unverifiedPhone.items.find((entry) => entry.key === 'phone').done, false, 'a typed-in number is not a verified number')
})

test('riders need documents and approval; partners need a business registration answer', () => {
  const rider = summarise(riderChecklist({ user: { firstName: 'Tobi', lastName: 'A' }, rider: { status: 'PENDING_APPROVAL', vehicleType: 'motorcycle', vehicleDetails: null, application: { identityDocuments: [] }, documents: [] } }))
  assert.equal(rider.items.find((entry) => entry.key === 'vehicle').done, false, 'motorcycles need registration details')
  assert.equal(rider.items.find((entry) => entry.key === 'documents').done, false)
  const bicycle = riderChecklist({ user: {}, rider: { vehicleType: 'bicycle' } })
  assert.equal(bicycle.find((entry) => entry.key === 'vehicle').done, true)

  const informal = partnerChecklist({ user: {}, restaurant: { application: { registrationType: 'NOT_REGISTERED', businessVerificationStatus: 'NON_REGISTERED' } }, menuItemCount: 2 })
  assert.equal(informal.find((entry) => entry.key === 'business').done, true, 'non-registered businesses are not penalised')
  const pending = partnerChecklist({ user: {}, restaurant: { application: { registrationType: 'REGISTERED', businessVerificationStatus: 'PENDING_REVIEW' } }, menuItemCount: 7 })
  assert.equal(pending.find((entry) => entry.key === 'business').done, false, 'a registered business counts once verified')
  assert.equal(pending.find((entry) => entry.key === 'menu').done, true)
})
