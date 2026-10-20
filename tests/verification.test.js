import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decideBusinessVerification, initialBusinessVerification, riderApprovalBlocker } from '../server/businessVerification.js'
import { checkBusinessRegistration, checkRiderIdentity, cleanRegistrationNumber, namesMatch, registryProvider } from '../server/registryChecks.js'

test('non-registered businesses can apply without any certificate and are never labelled registered', () => {
  assert.deepEqual(initialBusinessVerification({ registrationType: 'NOT_REGISTERED' }), { registrationType: 'NOT_REGISTERED', businessVerificationStatus: 'NON_REGISTERED', businessVerificationNote: null })
  assert.equal(initialBusinessVerification({}).businessVerificationStatus, 'NON_REGISTERED', 'no answer and no number means not registered')
})

test('registered businesses need a valid number and the certificate before review', () => {
  assert.equal(initialBusinessVerification({ registrationType: 'REGISTERED', registrationNumber: 'hello' }).businessVerificationStatus, 'ACTION_REQUIRED')
  assert.equal(initialBusinessVerification({ registrationType: 'REGISTERED', registrationNumber: 'RC 1234567', hasCertificate: false }).businessVerificationStatus, 'ACTION_REQUIRED')
  assert.equal(initialBusinessVerification({ registrationType: 'REGISTERED', registrationNumber: 'RC 1234567', hasCertificate: true }).businessVerificationStatus, 'PENDING_REVIEW')
  assert.deepEqual(cleanRegistrationNumber('bn-0012345'), { prefix: 'BN', digits: '0012345' })
  assert.equal(cleanRegistrationNumber('12'), null)
})

test('an upload alone never verifies; verification needs a registry match or a reviewed certificate', () => {
  const registered = { registrationType: 'REGISTERED', registrationNumber: 'RC 1234567' }
  assert.throws(() => decideBusinessVerification(registered, { decision: 'VERIFIED' }, { hasCertificate: true, hasRegistryMatch: false }), { code: 'EVIDENCE_REQUIRED' })
  assert.equal(decideBusinessVerification(registered, { decision: 'VERIFIED' }, { hasCertificate: true, hasRegistryMatch: false, reviewedCertificate: true }).businessVerificationStatus, 'VERIFIED')
  assert.equal(decideBusinessVerification(registered, { decision: 'VERIFIED' }, { hasCertificate: false, hasRegistryMatch: true }).businessVerificationStatus, 'VERIFIED')
  assert.throws(() => decideBusinessVerification({ registrationType: 'NOT_REGISTERED' }, { decision: 'VERIFIED' }, { hasCertificate: true, hasRegistryMatch: true, reviewedCertificate: true }), { code: 'NOT_A_REGISTERED_BUSINESS' })
  assert.throws(() => decideBusinessVerification(registered, { decision: 'REJECTED', note: '' }, {}), { code: 'NOTE_REQUIRED' })
  assert.deepEqual(decideBusinessVerification(registered, { decision: 'ACTION_REQUIRED', note: 'Certificate is blurry' }, {}), { businessVerificationStatus: 'ACTION_REQUIRED', businessVerificationNote: 'Certificate is blurry' })
})

test('riders cannot be approved without identity evidence', () => {
  assert.match(riderApprovalBlocker({ documentCount: 0, hasIdMatch: false }), /ID document/)
  assert.equal(riderApprovalBlocker({ documentCount: 1, hasIdMatch: false }), null)
  assert.equal(riderApprovalBlocker({ documentCount: 0, hasIdMatch: true }), null)
})

test('business names are compared loosely but meaningfully', () => {
  assert.equal(namesMatch('MAMA PUT KITCHEN LIMITED', 'Mama Put Kitchen'), true)
  assert.equal(namesMatch('MAMA PUT KITCHEN LTD', 'Sapele Fresh Mart'), false)
})

test('registry checks refuse to run without a key and map Ninja responses without storing records', async () => {
  delete process.env.NINJA_SECRET_KEY
  assert.equal(registryProvider(), null)
  await assert.rejects(checkBusinessRegistration({ registrationNumber: 'RC 1234567', businessName: 'X' }, { fetchImpl: async () => { throw new Error('should not call') } }), { code: 'REGISTRY_NOT_CONFIGURED' })

  process.env.NINJA_SECRET_KEY = 'sk_sandbox_test'
  assert.equal(registryProvider().baseUrl, 'https://api.sandbox.ninja.boucloud.io')
  const calls = []
  const reply = (status, body) => async (url, init) => { calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization }); return { ok: status < 400, status, json: async () => body } }
  const found = await checkBusinessRegistration({ registrationNumber: 'RC 1234567', businessName: 'Mama Put Kitchen' }, { fetchImpl: reply(200, { id: 'req1', status: 'found', data: { name: 'MAMA PUT KITCHEN LIMITED', registration_number: '1234567', status: 'ACTIVE', company_type: 'PRIVATE_COMPANY_LIMITED_BY_SHARES', directors: [{ name: 'A B' }] } }) })
  assert.equal(calls[0].url, 'https://api.sandbox.ninja.boucloud.io/api/company/lookup')
  assert.equal(calls[0].body.rc_number, '1234567')
  assert.equal(calls[0].auth, 'Bearer sk_sandbox_test')
  assert.equal(found.outcome, 'MATCH')
  assert.equal(found.summary.directorCount, 1)
  assert.equal(JSON.stringify(found.summary).includes('A B'), false, 'director names are not stored')
  assert.equal((await checkBusinessRegistration({ registrationNumber: 'RC 1234567', businessName: 'Other Shop' }, { fetchImpl: reply(200, { status: 'found', data: { name: 'MAMA PUT KITCHEN LIMITED', status: 'ACTIVE' } }) })).outcome, 'NAME_MISMATCH')
  assert.equal((await checkBusinessRegistration({ registrationNumber: 'RC 1234567', businessName: 'X' }, { fetchImpl: reply(200, { status: 'not_found', data: null }) })).outcome, 'NOT_FOUND')
  await assert.rejects(checkBusinessRegistration({ registrationNumber: 'RC 1234567', businessName: 'X' }, { fetchImpl: reply(402, { type: 'insufficient_funds' }) }), { code: 'REGISTRY_INSUFFICIENT_FUNDS' })

  const id = await checkRiderIdentity({ identityType: 'national-id', identityNumber: '12345678901', firstName: 'Tobi', lastName: 'Ade' }, { fetchImpl: reply(200, { id: 'v1', found: true, verified: true, score: 0.97, recommendation: 'accept', fields: [] }) })
  assert.equal(calls.at(-1).body.idType, 'nin')
  assert.equal(calls.at(-1).body.mode, 'verify', 'verify mode returns a verdict, not the person’s record')
  assert.equal(id.outcome, 'MATCH')
  assert.equal((await checkRiderIdentity({ identityType: 'drivers-license', identityNumber: 'ABC', firstName: 'T', lastName: 'A' }, { fetchImpl: reply(200, { found: true, verified: false, score: 0.4, recommendation: 'reject', fields: [{ field: 'lastName', match: false }] }) })).outcome, 'NO_MATCH')
  await assert.rejects(checkRiderIdentity({ identityType: 'passport', identityNumber: 'A1', firstName: 'T', lastName: 'A' }, { fetchImpl: reply(200, {}) }), { code: 'DATE_OF_BIRTH_REQUIRED' })
  delete process.env.NINJA_SECRET_KEY
})
