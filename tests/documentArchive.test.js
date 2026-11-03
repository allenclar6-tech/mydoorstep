import test from 'node:test'
import assert from 'node:assert/strict'
import { archiveFileName, archiveRows, documentTypeLabel } from '../server/documentArchive.js'

const businessDocs = [{ id: 'b1', applicationId: 'a1', type: 'BUSINESS_REGISTRATION', storageKey: 'private/applications/1-x.pdf', createdAt: new Date('2026-10-01T10:00:00Z'), verifiedAt: null, application: { status: 'APPROVED', ownerName: 'Ada Obi', ownerEmail: 'ada@example.com', ownerPhone: '+2348000000001', restaurant: { name: 'Mama Put Kitchen', storeType: 'RESTAURANT' } } }]
const shopDocs = [{ id: 'b2', applicationId: 'a2', type: 'IDENTITY', storageKey: 'private/applications/2-y.jpg', createdAt: new Date('2026-10-03T10:00:00Z'), verifiedAt: null, application: { status: 'REJECTED', ownerName: 'Tunde', ownerEmail: '', ownerPhone: '', restaurant: { name: 'Corner Mart', storeType: 'GROCERY' } } }]
const riderApplicationDocs = [{ id: 'r1', applicationId: 'ra1', type: 'IDENTITY', storageKey: 'private/applications/3-z.png', createdAt: new Date('2026-10-02T10:00:00Z'), verifiedAt: new Date('2026-10-04T10:00:00Z'), application: { status: 'PENDING_APPROVAL', rider: { user: { firstName: 'Efe', lastName: 'Ighodaro', email: 'efe@example.com', phone: '+2348000000002' } } } }]

test('documents from businesses, shops and riders become one list, newest first', () => {
  const rows = archiveRows({ businessDocs: [...businessDocs, ...shopDocs], riderApplicationDocs })
  assert.deepEqual(rows.map((row) => row.id), ['b2', 'r1', 'b1'])
  assert.deepEqual(rows.map((row) => row.kind), ['grocery', 'rider', 'restaurant'])
  assert.equal(rows[1].owner, 'Efe Ighodaro')
  assert.equal(rows[2].owner, 'Mama Put Kitchen')
  assert.equal(rows[2].status, 'APPROVED')
})

test('rejected and approved partners keep their documents in the list', () => {
  const statuses = archiveRows({ businessDocs: [...businessDocs, ...shopDocs] }).map((row) => row.status)
  assert.deepEqual(statuses.sort(), ['APPROVED', 'REJECTED'])
})

test('downloads get a clear, safe file name', () => {
  const [row] = archiveRows({ riderApplicationDocs })
  assert.equal(archiveFileName(row), 'Rider-Efe-Ighodaro-ID-document-2026-10-02.png')
  const [odd] = archiveRows({ businessDocs: [{ ...businessDocs[0], application: { ...businessDocs[0].application, restaurant: { name: 'Bad"/\\Name;', storeType: 'RESTAURANT' } } }] })
  assert.match(archiveFileName(odd), /^Restaurant-Bad-Name-Business-registration-CAC-2026-10-01\.pdf$/)
  assert.equal(documentTypeLabel('VEHICLE_PAPERS'), 'Vehicle papers')
})
