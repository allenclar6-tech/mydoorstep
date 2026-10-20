import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { test } from 'node:test'
import { googleIsAuthoritativeFor, resetGoogleKeyCache, verifyGoogleIdToken } from '../server/googleAuth.js'
import { linkGoogle, resolveGoogleSignIn, resolvePhoneSignIn, unlinkGoogle } from '../server/accountLinking.js'

const CLIENT = 'test-client.apps.googleusercontent.com'
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }
const certs = async () => ({ ok: true, headers: { get: () => 'public, max-age=600' }, json: async () => ({ keys: [jwk] }) })
const now = Date.UTC(2026, 9, 20, 12, 0, 0)
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
function token(claims = {}, { kid = 'k1', key = privateKey, alg = 'RS256' } = {}) {
  const header = b64({ alg, kid, typ: 'JWT' })
  const payload = b64({ iss: 'https://accounts.google.com', aud: CLIENT, sub: '1001', email: 'ada@gmail.com', email_verified: true, iat: now / 1000 - 10, exp: now / 1000 + 3600, given_name: 'Ada', family_name: 'Obi', ...claims })
  return `${header}.${payload}.${sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), key).toString('base64url')}`
}
const verify = (value) => { resetGoogleKeyCache(); return verifyGoogleIdToken(value, { fetchImpl: certs, now, clientIds: [CLIENT] }) }

test('a genuine Google ID token is accepted and mapped to an identity', async () => {
  const identity = await verify(token())
  assert.equal(identity.sub, '1001')
  assert.equal(identity.email, 'ada@gmail.com')
  assert.equal(identity.emailVerified, true)
})

test('forged, foreign, expired or malformed Google tokens are rejected', async () => {
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
  await assert.rejects(verify(token({}, { key: other })), { code: 'GOOGLE_TOKEN_INVALID' }, 'wrong signing key')
  await assert.rejects(verify(token({ aud: 'someone-else' })), { code: 'GOOGLE_TOKEN_INVALID' }, 'other app')
  await assert.rejects(verify(token({ iss: 'https://evil.example' })), { code: 'GOOGLE_TOKEN_INVALID' }, 'other issuer')
  await assert.rejects(verify(token({ exp: now / 1000 - 3600 })), { code: 'GOOGLE_TOKEN_EXPIRED' })
  await assert.rejects(verify(token({}, { alg: 'HS256' })), { code: 'GOOGLE_TOKEN_INVALID' }, 'algorithm swap')
  await assert.rejects(verify(token({}, { kid: 'unknown' })), { code: 'GOOGLE_TOKEN_INVALID' })
  await assert.rejects(verify('not.a.jwt'), { code: 'GOOGLE_TOKEN_INVALID' })
  const parts = token().split('.')
  await assert.rejects(verify(`${parts[0]}.${b64({ ...JSON.parse(Buffer.from(parts[1], 'base64url')), sub: 'attacker' })}.${parts[2]}`), { code: 'GOOGLE_TOKEN_INVALID' }, 'tampered claims')
  await assert.rejects(verifyGoogleIdToken(token(), { fetchImpl: certs, now, clientIds: [] }), { code: 'GOOGLE_SIGN_IN_NOT_CONFIGURED' })
})

test('Google is only trusted for gmail addresses or verified hosted-domain addresses', () => {
  assert.equal(googleIsAuthoritativeFor({ email: 'a@gmail.com', emailVerified: true }), true)
  assert.equal(googleIsAuthoritativeFor({ email: 'a@company.ng', emailVerified: true, hostedDomain: 'company.ng' }), true)
  assert.equal(googleIsAuthoritativeFor({ email: 'a@yahoo.com', emailVerified: true }), false)
  assert.equal(googleIsAuthoritativeFor({ email: 'a@gmail.com', emailVerified: false }), false)
})

function fakeDb({ users = [], identities = [] } = {}) {
  const db = {
    users, identities,
    user: {
      findUnique: async ({ where }) => users.find((user) => (where.email && user.email === where.email) || (where.phone && user.phone === where.phone) || (where.id && user.id === where.id)) || null,
      create: async ({ data }) => {
        const user = { id: `u${users.length + 1}`, status: 'ACTIVE', ...data }
        delete user.customer; delete user.authIdentities
        users.push(user)
        if (data.authIdentities) identities.push({ id: `i${identities.length + 1}`, userId: user.id, ...data.authIdentities.create })
        return user
      },
    },
    authIdentity: {
      findUnique: async ({ where }) => { const found = identities.find((row) => row.provider === where.provider_subject.provider && row.subject === where.provider_subject.subject); return found ? { ...found, user: users.find((user) => user.id === found.userId) } : null },
      findFirst: async ({ where }) => identities.find((row) => row.userId === where.userId && row.provider === where.provider) || null,
      create: async ({ data }) => { identities.push({ id: `i${identities.length + 1}`, ...data }); return data },
      update: async () => undefined,
      delete: async ({ where }) => { identities.splice(identities.findIndex((row) => row.id === where.id), 1) },
    },
  }
  return db
}
const google = (overrides = {}) => ({ sub: 'g1', email: 'ada@gmail.com', emailVerified: true, hostedDomain: null, givenName: 'Ada', familyName: 'Obi', ...overrides })

test('a new Google user gets one customer account with a verified email and no password', async () => {
  const db = fakeDb()
  await assert.rejects(resolveGoogleSignIn(db, google()), { code: 'TERMS_REQUIRED' })
  const result = await resolveGoogleSignIn(db, google(), { termsAccepted: true })
  assert.equal(result.created, true)
  assert.equal(result.user.role, 'CUSTOMER')
  assert.equal(result.user.passwordHash, null)
  assert.ok(result.user.emailVerifiedAt)
  const again = await resolveGoogleSignIn(db, google())
  assert.equal(again.user.id, result.user.id, 'same Google account signs into the same DOORSTEP account')
  assert.equal(db.users.length, 1)
})

test('an existing verified gmail customer is linked, but unverified or non-authoritative emails are never merged', async () => {
  const verified = fakeDb({ users: [{ id: 'u1', email: 'ada@gmail.com', role: 'CUSTOMER', status: 'ACTIVE', emailVerifiedAt: new Date(), passwordHash: 'x' }] })
  const linked = await resolveGoogleSignIn(verified, google())
  assert.equal(linked.linked, true)
  assert.equal(linked.user.id, 'u1')

  const unverified = fakeDb({ users: [{ id: 'u1', email: 'ada@gmail.com', role: 'CUSTOMER', status: 'ACTIVE', emailVerifiedAt: null, passwordHash: 'x' }] })
  await assert.rejects(resolveGoogleSignIn(unverified, google()), { code: 'ACCOUNT_EXISTS_SIGN_IN_TO_LINK' })
  assert.equal(unverified.identities.length, 0)

  const otherDomain = fakeDb({ users: [{ id: 'u1', email: 'ada@yahoo.com', role: 'CUSTOMER', status: 'ACTIVE', emailVerifiedAt: new Date(), passwordHash: 'x' }] })
  await assert.rejects(resolveGoogleSignIn(otherDomain, google({ email: 'ada@yahoo.com' })), { code: 'ACCOUNT_EXISTS_SIGN_IN_TO_LINK' })

  await assert.rejects(resolveGoogleSignIn(fakeDb(), google({ emailVerified: false }), { termsAccepted: true }), { code: 'GOOGLE_EMAIL_NOT_VERIFIED' })
})

test('Google cannot be used to enter partner, rider or admin accounts', async () => {
  for (const role of ['ADMIN', 'RIDER', 'RESTAURANT']) {
    const db = fakeDb({ users: [{ id: 'u1', email: 'ada@gmail.com', role, status: 'ACTIVE', emailVerifiedAt: new Date(), passwordHash: 'x' }] })
    await assert.rejects(resolveGoogleSignIn(db, google()), { code: 'GOOGLE_CUSTOMERS_ONLY' }, role)
  }
})

test('linking from a signed-in account refuses a Google account owned by someone else, and unlinking keeps a way in', async () => {
  const db = fakeDb({ users: [{ id: 'u1', email: 'a@x.ng', role: 'CUSTOMER', status: 'ACTIVE', passwordHash: null }, { id: 'u2', email: 'b@x.ng', role: 'CUSTOMER', status: 'ACTIVE', passwordHash: 'x' }], identities: [{ id: 'i1', userId: 'u2', provider: 'google', subject: 'g2' }] })
  await assert.rejects(linkGoogle(db, db.users[0], google({ sub: 'g2' })), { code: 'GOOGLE_ALREADY_LINKED' })
  assert.deepEqual(await linkGoogle(db, db.users[0], google({ sub: 'g9' })), { linked: true })
  await assert.rejects(unlinkGoogle(db, db.users[0]), { code: 'LAST_SIGN_IN_METHOD' }, 'no password and no verified phone')
  assert.deepEqual(await unlinkGoogle(db, db.users[1]), { unlinked: true })
})

test('phone-code sign-in only opens customer accounts whose phone was already verified', async () => {
  const db = fakeDb({ users: [
    { id: 'u1', phone: '+2348000000001', role: 'CUSTOMER', status: 'ACTIVE', phoneVerifiedAt: new Date() },
    { id: 'u2', phone: '+2348000000002', role: 'CUSTOMER', status: 'ACTIVE', phoneVerifiedAt: null },
    { id: 'u3', phone: '+2348000000003', role: 'RIDER', status: 'ACTIVE', phoneVerifiedAt: new Date() },
  ] })
  assert.equal((await resolvePhoneSignIn(db, '+2348000000001')).id, 'u1')
  assert.equal(await resolvePhoneSignIn(db, '+2348000000002'), null, 'an unverified number someone typed in cannot be used to take the account')
  assert.equal(await resolvePhoneSignIn(db, '+2348000000009'), null)
  await assert.rejects(resolvePhoneSignIn(db, '+2348000000003'), { code: 'PHONE_CUSTOMERS_ONLY' })
})
