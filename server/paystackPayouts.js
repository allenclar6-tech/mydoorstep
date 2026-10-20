// Paystack calls for paying businesses and riders: bank list, account-name check, subaccounts (for automatic
// split settlement) and transfer recipients / transfers (for rider earnings and anything not settled by split).
// Endpoints follow https://paystack.com/docs/api/ . The secret key never leaves the server.

export class PayoutError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status }
}

async function paystack(method, path, { body, query, fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
  const secret = process.env.PAYSTACK_SECRET_KEY
  if (!secret) throw new PayoutError('PAYMENT_PROVIDER_NOT_CONFIGURED', 'Paystack is not configured on the server.', 503)
  const url = new URL(`https://api.paystack.co${path}`)
  Object.entries(query || {}).forEach(([key, value]) => url.searchParams.set(key, String(value)))
  let response
  try {
    response = await fetchImpl(url.toString(), { method, headers: { Authorization: `Bearer ${secret}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) })
  } catch {
    // A timeout or dropped connection may happen after Paystack acted on the request: the outcome is unknown.
    throw Object.assign(new PayoutError('PAYSTACK_UNAVAILABLE', 'Paystack could not be reached. Try again shortly.', 502), { definite: false })
  }
  const parsed = await response.json().catch(() => null)
  if (!response.ok || parsed?.status !== true) {
    console.warn('[payouts] paystack_rejected', JSON.stringify({ path: path.replace(/\/[A-Za-z0-9_]{12,}$/, '/:id'), status: response.status }))
    // Only a clear 4xx answer means Paystack refused. A 5xx, or a 2xx we could not read, may still have gone through.
    const definite = !response.ok && response.status < 500
    throw Object.assign(new PayoutError('PAYSTACK_REJECTED', parsed?.message || 'Paystack rejected the request.', response.status === 429 ? 429 : response.status >= 500 ? 502 : 400), { definite })
  }
  return parsed.data
}

let bankCache = { at: 0, banks: [] }
export async function listBanks({ fetchImpl } = {}) {
  if (bankCache.banks.length && Date.now() - bankCache.at < 12 * 60 * 60 * 1000) return bankCache.banks
  const data = await paystack('GET', '/bank', { query: { country: 'nigeria', currency: 'NGN', perPage: 100 }, fetchImpl })
  const banks = (data || []).filter((bank) => bank.active !== false && (!bank.type || bank.type === 'nuban')).map((bank) => ({ name: bank.name, code: bank.code })).sort((a, b) => a.name.localeCompare(b.name))
  bankCache = { at: Date.now(), banks }
  return banks
}

/** Confirms the account exists and returns the name the bank holds for it. */
export async function resolveAccount({ accountNumber, bankCode }, { fetchImpl } = {}) {
  if (!/^\d{10}$/.test(String(accountNumber))) throw new PayoutError('ACCOUNT_NUMBER_INVALID', 'Nigerian account numbers have 10 digits.')
  if (!/^[A-Za-z0-9]{3,10}$/.test(String(bankCode))) throw new PayoutError('BANK_INVALID', 'Choose your bank from the list.')
  try {
    const data = await paystack('GET', '/bank/resolve', { query: { account_number: accountNumber, bank_code: bankCode }, fetchImpl })
    if (!data?.account_name) throw new PayoutError('ACCOUNT_NOT_FOUND', 'We could not find that account. Check the number and bank.')
    return { accountName: data.account_name, accountNumber: data.account_number || accountNumber }
  } catch (error) {
    if (error.code === 'PAYSTACK_REJECTED') throw new PayoutError('ACCOUNT_NOT_FOUND', 'We could not find that account. Check the number and bank.')
    throw error
  }
}

/** Subaccount: lets Paystack settle a business's share of each card payment straight to its bank. */
export async function upsertSubaccount({ existingCode, businessName, bankCode, accountNumber, email, phone }, { fetchImpl } = {}) {
  const body = { business_name: businessName.slice(0, 100), settlement_bank: bankCode, bank_code: bankCode, account_number: accountNumber, percentage_charge: 0, primary_contact_email: email || undefined, primary_contact_phone: phone || undefined, description: 'DOORSTEP partner payouts' }
  const data = existingCode ? await paystack('PUT', `/subaccount/${encodeURIComponent(existingCode)}`, { body, fetchImpl }) : await paystack('POST', '/subaccount', { body, fetchImpl })
  if (!data?.subaccount_code) throw new PayoutError('SUBACCOUNT_FAILED', 'Paystack did not create the payout account.', 502)
  return { subaccountCode: data.subaccount_code }
}

/** Transfer recipient: lets DOORSTEP send money to the account (rider earnings, adjustments, bank-transfer orders). */
export async function createRecipient({ name, bankCode, accountNumber, ownerRef }, { fetchImpl } = {}) {
  const data = await paystack('POST', '/transferrecipient', { body: { type: 'nuban', name: name.slice(0, 100), account_number: accountNumber, bank_code: bankCode, currency: 'NGN', metadata: { owner: ownerRef } }, fetchImpl })
  if (!data?.recipient_code) throw new PayoutError('RECIPIENT_FAILED', 'Paystack did not create the transfer recipient.', 502)
  return { recipientCode: data.recipient_code }
}

/**
 * Sends a transfer from the DOORSTEP Paystack balance. Paystack returns `pending`/`success`, or `otp` when the
 * account still requires OTP confirmation (turn that off in Paystack → Settings → Preferences for automation).
 */
export async function sendTransfer({ amountMinor, recipientCode, reference, reason }, { fetchImpl } = {}) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 100) throw new PayoutError('AMOUNT_INVALID', 'Transfer amount is too small.')
  if (!/^[a-z0-9_-]{16,50}$/.test(reference)) throw new PayoutError('REFERENCE_INVALID', 'Invalid transfer reference.')
  const data = await paystack('POST', '/transfer', { body: { source: 'balance', amount: amountMinor, recipient: recipientCode, reference, reason: reason.slice(0, 100), currency: 'NGN' }, fetchImpl })
  return { status: data?.status || 'pending', transferCode: data?.transfer_code || null }
}

/**
 * True when a failed sendTransfer certainly moved no money: our own validation stopped it, or Paystack
 * answered with a clear refusal. Timeouts, 5xx and unreadable replies are not certain, so the payout must
 * stay in progress until the transfer webhook or a verify call settles it; otherwise the amount would be
 * owed again and could be paid twice.
 */
export function transferCertainlyNotSent(error) {
  if (!(error instanceof PayoutError)) return false
  if (['AMOUNT_INVALID', 'REFERENCE_INVALID', 'PAYMENT_PROVIDER_NOT_CONFIGURED'].includes(error.code)) return true
  return error.definite === true
}

export async function verifyTransfer(reference, { fetchImpl } = {}) {
  const data = await paystack('GET', `/transfer/verify/${encodeURIComponent(reference)}`, { fetchImpl })
  return { status: data?.status || null, transferCode: data?.transfer_code || null, reason: data?.reason || null }
}

export const maskAccount = (accountNumber) => `••••${String(accountNumber).slice(-4)}`
