import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRecipient, maskAccount, resolveAccount, sendTransfer, transferCertainlyNotSent, upsertSubaccount } from '../server/paystackPayouts.js'

process.env.PAYSTACK_SECRET_KEY = 'sk_test_unit'
const recorder = (reply) => { const calls = []; const fetchImpl = async (url, init) => { calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null }); return { ok: reply.ok !== false, status: reply.status || 200, json: async () => reply.body } }; return { calls, fetchImpl } }

test('bank accounts are checked with Paystack before being saved', async () => {
  const ok = recorder({ body: { status: true, data: { account_name: 'ADA OBI', account_number: '0123456789' } } })
  assert.deepEqual(await resolveAccount({ accountNumber: '0123456789', bankCode: '058' }, { fetchImpl: ok.fetchImpl }), { accountName: 'ADA OBI', accountNumber: '0123456789' })
  assert.match(ok.calls[0].url, /\/bank\/resolve\?account_number=0123456789&bank_code=058$/)
  await assert.rejects(resolveAccount({ accountNumber: '123', bankCode: '058' }, { fetchImpl: ok.fetchImpl }), { code: 'ACCOUNT_NUMBER_INVALID' })
  const missing = recorder({ ok: false, status: 422, body: { status: false, message: 'Could not resolve account name' } })
  await assert.rejects(resolveAccount({ accountNumber: '0123456789', bankCode: '058' }, { fetchImpl: missing.fetchImpl }), { code: 'ACCOUNT_NOT_FOUND' })
})

test('businesses get a subaccount (for automatic split) and payees get a transfer recipient', async () => {
  const sub = recorder({ body: { status: true, data: { subaccount_code: 'ACCT_abc' } } })
  assert.deepEqual(await upsertSubaccount({ businessName: 'Mama Put', bankCode: '058', accountNumber: '0123456789' }, { fetchImpl: sub.fetchImpl }), { subaccountCode: 'ACCT_abc' })
  assert.equal(sub.calls[0].method, 'POST')
  assert.equal(sub.calls[0].body.percentage_charge, 0, 'DOORSTEP takes its commission through the per-order split, not a blanket percentage')
  await upsertSubaccount({ existingCode: 'ACCT_abc', businessName: 'Mama Put', bankCode: '058', accountNumber: '0123456789' }, { fetchImpl: sub.fetchImpl })
  assert.equal(sub.calls[1].method, 'PUT')
  assert.match(sub.calls[1].url, /\/subaccount\/ACCT_abc$/)
  const rec = recorder({ body: { status: true, data: { recipient_code: 'RCP_1' } } })
  assert.deepEqual(await createRecipient({ name: 'ADA OBI', bankCode: '058', accountNumber: '0123456789', ownerRef: 'rider:r1' }, { fetchImpl: rec.fetchImpl }), { recipientCode: 'RCP_1' })
  assert.equal(rec.calls[0].body.type, 'nuban')
})

test('transfers use a strict reference and report OTP or pending honestly', async () => {
  await assert.rejects(sendTransfer({ amountMinor: 50_000, recipientCode: 'RCP_1', reference: 'BAD REF', reason: 'x' }), { code: 'REFERENCE_INVALID' })
  await assert.rejects(sendTransfer({ amountMinor: 50, recipientCode: 'RCP_1', reference: 'dsp_payout_abcdef1234567890', reason: 'x' }), { code: 'AMOUNT_INVALID' })
  const otp = recorder({ body: { status: true, data: { status: 'otp', transfer_code: 'TRF_1' } } })
  assert.deepEqual(await sendTransfer({ amountMinor: 50_000, recipientCode: 'RCP_1', reference: 'dsp_payout_abcdef1234567890', reason: 'payout' }, { fetchImpl: otp.fetchImpl }), { status: 'otp', transferCode: 'TRF_1' })
  assert.equal(otp.calls[0].body.source, 'balance')
  assert.equal(maskAccount('0123456789'), '••••6789')
})

test('a payout is only reversed when Paystack certainly did not send it', async () => {
  const ref = 'dsp_payout_abcdef1234567890'
  const attempt = async (fetchImpl) => { try { await sendTransfer({ amountMinor: 50_000, recipientCode: 'RCP_1', reference: ref, reason: 'payout' }, { fetchImpl }); return null } catch (error) { return error } }
  // Clear refusals: nothing was sent, so the money is owed again.
  assert.equal(transferCertainlyNotSent(await attempt(recorder({ ok: false, status: 400, body: { status: false, message: 'Insufficient balance' } }).fetchImpl)), true)
  assert.equal(transferCertainlyNotSent(await attempt(recorder({ ok: false, status: 429, body: { status: false } }).fetchImpl)), true)
  assert.equal(transferCertainlyNotSent(await sendTransfer({ amountMinor: 50, recipientCode: 'RCP_1', reference: ref, reason: 'x' }).catch((error) => error)), true)
  // Unknown outcomes: a timeout, a Paystack 5xx, or a 2xx we could not read may have moved money.
  assert.equal(transferCertainlyNotSent(await attempt(async () => { throw new Error('timeout') })), false)
  assert.equal(transferCertainlyNotSent(await attempt(recorder({ ok: false, status: 503, body: null }).fetchImpl)), false)
  assert.equal(transferCertainlyNotSent(await attempt(async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json') } }))), false)
  assert.equal(transferCertainlyNotSent(new Error('unrelated')), false)
})
