import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

// Saved cards are Paystack "authorizations": a token Paystack issues after a successful
// card payment. DOORSTEP never receives card numbers or CVVs. The token is still sensitive
// (with the secret key it can charge the card), so it is encrypted at rest with
// CARD_TOKEN_ENCRYPTION_KEY, which lives only on the API host.

export class CardError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status }
}

function encryptionKey() {
  const raw = process.env.CARD_TOKEN_ENCRYPTION_KEY || ''
  if (raw.length < 32) return null
  return createHash('sha256').update(raw).digest()
}

export function savedCardsEnabled() {
  return Boolean(encryptionKey() && process.env.PAYSTACK_SECRET_KEY)
}

export function encryptToken(plain) {
  const key = encryptionKey()
  if (!key) throw new CardError('SAVED_CARDS_NOT_CONFIGURED', 'Saved cards are not configured on the server.', 503)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join(':')
}

export function decryptToken(stored) {
  const key = encryptionKey()
  if (!key) throw new CardError('SAVED_CARDS_NOT_CONFIGURED', 'Saved cards are not configured on the server.', 503)
  const [version, iv, tag, data] = String(stored).split(':')
  if (version !== 'v1' || !iv || !tag || !data) throw new CardError('SAVED_CARD_UNREADABLE', 'This saved card can no longer be used. Remove it and add it again.', 409)
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'))
    decipher.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    throw new CardError('SAVED_CARD_UNREADABLE', 'This saved card can no longer be used. Remove it and add it again.', 409)
  }
}

export function publicCard(card) {
  return { id: card.id, brand: card.brand, bank: card.bank, last4: card.last4, expMonth: card.expMonth, expYear: card.expYear, expired: isExpired(card), lastUsedAt: card.lastUsedAt, createdAt: card.createdAt }
}

export function isExpired(card, now = new Date()) {
  const year = Number(card.expYear)
  const month = Number(card.expMonth)
  if (!year || !month) return false
  return year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)
}

/**
 * Stores a reusable card from a verified Paystack transaction. Only card payments whose
 * authorization Paystack marks reusable are kept. Returns the saved card or null.
 */
export async function saveCardFromAuthorization(prisma, userId, { authorization, customerEmail, channel }) {
  if (!savedCardsEnabled()) return null
  if (!authorization || channel !== 'card' || authorization.reusable !== true || !authorization.authorization_code || !authorization.signature) return null
  if (!/^\d{4}$/.test(String(authorization.last4 || ''))) return null
  const data = {
    authorizationCipher: encryptToken(authorization.authorization_code),
    email: customerEmail,
    brand: authorization.brand || authorization.card_type || null,
    bank: authorization.bank || null,
    last4: String(authorization.last4),
    expMonth: String(authorization.exp_month || ''),
    expYear: String(authorization.exp_year || ''),
    removedAt: null,
  }
  return prisma.savedCard.upsert({ where: { userId_signature: { userId, signature: authorization.signature } }, update: data, create: { userId, signature: authorization.signature, ...data } })
}

async function paystack(path, body, fetchImpl) {
  const secret = process.env.PAYSTACK_SECRET_KEY
  if (!secret) throw new CardError('PAYMENT_PROVIDER_NOT_CONFIGURED', 'Card payments are not configured.', 503)
  let response
  try {
    response = await fetchImpl(`https://api.paystack.co${path}`, { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) })
  } catch {
    throw new CardError('PAYMENT_PROVIDER_UNAVAILABLE', 'Paystack could not be reached. Try again shortly.', 502)
  }
  let parsed = null
  try { parsed = await response.json() } catch { parsed = null }
  return { ok: response.ok && parsed?.status === true, status: response.status, body: parsed }
}

/** Charges a saved card. Paystack's own response decides the outcome; nothing is assumed. */
export async function chargeSavedCard(card, { amountMinor, reference, metadata }, { fetchImpl = globalThis.fetch } = {}) {
  const result = await paystack('/transaction/charge_authorization', { email: card.email, amount: amountMinor, authorization_code: decryptToken(card.authorizationCipher), reference, currency: 'NGN', metadata }, fetchImpl)
  const data = result.body?.data
  if (!data) {
    console.error('[cards] charge_rejected', JSON.stringify({ status: result.status }))
    throw new CardError('SAVED_CARD_CHARGE_REJECTED', result.body?.message ? `Paystack declined the saved card: ${result.body.message}` : 'Paystack declined the saved card.', 402)
  }
  return { status: data.status, reference: data.reference, amount: data.amount, currency: data.currency, id: data.id, gatewayResponse: data.gateway_response || null, paidAt: data.paid_at || data.transaction_date || null, authorization: data.authorization, channel: data.channel, customerEmail: data.customer?.email }
}

export async function refundTransaction(reference, { fetchImpl = globalThis.fetch } = {}) {
  const result = await paystack('/refund', { transaction: reference }, fetchImpl)
  return result.ok ? (result.body.data?.status || 'pending') : 'failed'
}

export async function deactivateAuthorization(card, { fetchImpl = globalThis.fetch } = {}) {
  try {
    const result = await paystack('/customer/deactivate_authorization', { authorization_code: decryptToken(card.authorizationCipher) }, fetchImpl)
    return result.ok
  } catch { return false }
}
