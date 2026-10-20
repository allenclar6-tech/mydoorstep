import assert from 'node:assert/strict'
import { test } from 'node:test'
import { issueVerificationCode, MAX_CODES_PER_HOUR, RESEND_COOLDOWN_MS, smsConfigured, verifyCode, whatsappConfigured } from '../server/verificationService.js'

const clearProviders = () => { for (const key of ['SMS_PROVIDER', 'TERMII_API_KEY', 'TERMII_BASE_URL', 'TERMII_SENDER_ID', 'TERMII_CHANNEL', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_AUTH_TEMPLATE']) delete process.env[key] }

function fakeDb() {
  const rows = []
  return {
    rows,
    verificationCode: {
      findMany: async ({ where, take }) => rows.filter((row) => row.destination === where.destination && row.channel === where.channel && row.createdAt > where.createdAt.gt).sort((a, b) => b.createdAt - a.createdAt).slice(0, take),
      updateMany: async ({ where, data }) => {
        const matches = rows.filter((row) => (!where.id || row.id === where.id) && (!where.destination || row.destination === where.destination) && (!where.channel || row.channel === where.channel) && (where.verifiedAt !== null || row.verifiedAt == null) && (!where.attempts || row.attempts < where.attempts.lt) && (!where.expiresAt || row.expiresAt > where.expiresAt.gt))
        for (const row of matches) { if (data.attempts?.increment) row.attempts += data.attempts.increment; else if (typeof data.attempts === 'number') row.attempts = data.attempts; if (data.verifiedAt) row.verifiedAt = data.verifiedAt }
        return { count: matches.length }
      },
      create: async ({ data }) => { const row = { id: `c${rows.length + 1}`, attempts: 0, verifiedAt: null, ...data, createdAt: data.createdAt || fakeDb.now }; rows.push(row); return row },
      delete: async ({ where }) => { rows.splice(rows.findIndex((row) => row.id === where.id), 1) },
      findUnique: async ({ where }) => rows.find((row) => row.id === where.id) || null,
    },
  }
}

// Captures the code a provider would deliver, without any network.
function capture() {
  const sent = []
  const fetchImpl = async (url, init) => {
    const body = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : JSON.parse(init.body)
    sent.push({ url, body })
    if (url.includes('graph.facebook.com')) return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.1' }] }) }
    if (url.includes('termii')) return { ok: true, status: 200, json: async () => ({ code: 'ok' }) }
    return { ok: true, status: 200, json: async () => ({}) }
  }
  const lastCode = () => { const body = sent.at(-1).body; const text = body.sms || body.Body || body.template?.components?.[0]?.parameters?.[0]?.text || ''; return /(\d{6})/.exec(text)?.[1] }
  return { sent, fetchImpl, lastCode }
}

test('providers are reported unconfigured until every required value is set', () => {
  clearProviders()
  assert.equal(smsConfigured(), false)
  assert.equal(whatsappConfigured(), false)
  Object.assign(process.env, { TERMII_API_KEY: 'k', TERMII_BASE_URL: 'https://example.termii.test', TERMII_SENDER_ID: 'DOORSTEP' })
  assert.equal(smsConfigured(), true)
  Object.assign(process.env, { WHATSAPP_ACCESS_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: '123', WHATSAPP_AUTH_TEMPLATE: 'doorstep_code' })
  assert.equal(whatsappConfigured(), true)
})

test('an unconfigured channel fails honestly and leaves no usable code behind', async () => {
  clearProviders()
  const db = fakeDb(); fakeDb.now = new Date()
  await assert.rejects(issueVerificationCode({ destination: '+2348012345678', channel: 'whatsapp' }, { db, fetchImpl: capture().fetchImpl, now: fakeDb.now }), { code: 'WHATSAPP_VERIFICATION_NOT_CONFIGURED' })
  assert.equal(db.rows.length, 0)
})

test('SMS codes go through Termii on the DND route and WhatsApp codes use the authentication template', async () => {
  clearProviders()
  Object.assign(process.env, { TERMII_API_KEY: 'k', TERMII_BASE_URL: 'https://example.termii.test/', TERMII_SENDER_ID: 'DOORSTEP', WHATSAPP_ACCESS_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: '123', WHATSAPP_AUTH_TEMPLATE: 'doorstep_code' })
  const db = fakeDb(); fakeDb.now = new Date()
  const { sent, fetchImpl, lastCode } = capture()
  await issueVerificationCode({ destination: '+2348012345678', channel: 'phone' }, { db, fetchImpl, now: fakeDb.now })
  assert.equal(sent[0].url, 'https://example.termii.test/api/sms/send')
  assert.equal(sent[0].body.channel, 'dnd')
  assert.equal(sent[0].body.to, '2348012345678')
  assert.match(lastCode(), /^\d{6}$/)
  await issueVerificationCode({ destination: '+2348012345679', channel: 'whatsapp' }, { db, fetchImpl, now: fakeDb.now })
  const whatsapp = sent[1]
  assert.equal(whatsapp.url, 'https://graph.facebook.com/v26.0/123/messages')
  assert.equal(whatsapp.body.template.name, 'doorstep_code')
  assert.equal(whatsapp.body.template.components[0].parameters[0].text, whatsapp.body.template.components[1].parameters[0].text, 'code in body and copy-code button')
  assert.ok(!db.rows.some((row) => JSON.stringify(row).includes(lastCode())), 'only a hash of the code is stored')
})

test('codes are single-use, expire, lock after five wrong tries, and are bound to their channel', async () => {
  clearProviders()
  Object.assign(process.env, { TERMII_API_KEY: 'k', TERMII_BASE_URL: 'https://example.termii.test', TERMII_SENDER_ID: 'DOORSTEP' })
  const db = fakeDb(); const start = new Date('2026-10-20T10:00:00Z'); fakeDb.now = start
  const { fetchImpl, lastCode } = capture()
  const phone = '+2348012345678'
  const first = await issueVerificationCode({ destination: phone, channel: 'phone' }, { db, fetchImpl, now: start })
  const code = lastCode()
  assert.equal(await verifyCode({ challengeId: first.challengeId, destination: phone, code, channels: ['password_reset'] }, { db, now: start }), false, 'wrong purpose')
  assert.equal(await verifyCode({ challengeId: first.challengeId, destination: '+2348099999999', code }, { db, now: start }), false, 'wrong number')
  assert.equal(await verifyCode({ challengeId: first.challengeId, destination: phone, code }, { db, now: start }), true)
  assert.equal(await verifyCode({ challengeId: first.challengeId, destination: phone, code }, { db, now: start }), false, 'reused')

  fakeDb.now = new Date(start.getTime() + RESEND_COOLDOWN_MS + 1000)
  const second = await issueVerificationCode({ destination: phone, channel: 'phone' }, { db, fetchImpl, now: fakeDb.now })
  const secondCode = lastCode()
  for (let attempt = 0; attempt < 5; attempt += 1) assert.equal(await verifyCode({ challengeId: second.challengeId, destination: phone, code: secondCode === '000000' ? '111111' : '000000' }, { db, now: fakeDb.now }), false)
  assert.equal(await verifyCode({ challengeId: second.challengeId, destination: phone, code: secondCode }, { db, now: fakeDb.now }), false, 'locked after 5 wrong attempts')

  fakeDb.now = new Date(fakeDb.now.getTime() + RESEND_COOLDOWN_MS + 1000)
  const third = await issueVerificationCode({ destination: phone, channel: 'phone' }, { db, fetchImpl, now: fakeDb.now })
  const thirdCode = lastCode()
  assert.equal(await verifyCode({ challengeId: third.challengeId, destination: phone, code: thirdCode }, { db, now: new Date(fakeDb.now.getTime() + 11 * 60_000) }), false, 'expired after 10 minutes')
})

test('resending is limited: one code per minute and five per hour per number', async () => {
  clearProviders()
  Object.assign(process.env, { TERMII_API_KEY: 'k', TERMII_BASE_URL: 'https://example.termii.test', TERMII_SENDER_ID: 'DOORSTEP' })
  const db = fakeDb(); let clock = new Date('2026-10-20T10:00:00Z'); fakeDb.now = clock
  const { fetchImpl } = capture()
  const phone = '+2348012345670'
  await issueVerificationCode({ destination: phone, channel: 'phone' }, { db, fetchImpl, now: clock })
  await assert.rejects(issueVerificationCode({ destination: phone, channel: 'phone' }, { db, fetchImpl, now: new Date(clock.getTime() + 10_000) }), (error) => error.code === 'VERIFICATION_COOLDOWN' && error.retryAfterSeconds === 50)
  for (let index = 1; index < MAX_CODES_PER_HOUR; index += 1) {
    clock = new Date(clock.getTime() + RESEND_COOLDOWN_MS + 1000); fakeDb.now = clock
    await issueVerificationCode({ destination: phone, channel: 'phone' }, { db, fetchImpl, now: clock })
  }
  clock = new Date(clock.getTime() + RESEND_COOLDOWN_MS + 1000); fakeDb.now = clock
  await assert.rejects(issueVerificationCode({ destination: phone, channel: 'phone' }, { db, fetchImpl, now: clock }), { code: 'VERIFICATION_HOURLY_LIMIT' })
  const issued = db.rows.filter((row) => row.destination === phone)
  assert.equal(issued.filter((row) => row.attempts < 5).length, 1, 'requesting a new code cancels the previous one')
})
