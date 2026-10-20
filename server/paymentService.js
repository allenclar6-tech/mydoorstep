import { createHmac, timingSafeEqual } from 'node:crypto'

const providers = {
  paystack: {
    initializeUrl: 'https://api.paystack.co/transaction/initialize',
    secret: () => process.env.PAYSTACK_SECRET_KEY,
  },
}

export async function initializePayment({ email, amountMinor, reference, callbackUrl, metadata = {}, channels, split }) {
  const providerName = process.env.PAYMENT_PROVIDER || process.env.PAYMENTS_PROVIDER || 'paystack'
  const provider = providers[providerName]
  if (!provider) throw new PaymentError('PAYMENT_PROVIDER_UNSUPPORTED', `No adapter is configured for ${providerName}.`, 503)
  const secret = provider.secret()
  if (!secret) throw new PaymentError('PAYMENT_PROVIDER_NOT_CONFIGURED', `${providerName} credentials are missing.`, 503)

  const response = await fetch(provider.initializeUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, amount: amountMinor, reference, callback_url: callbackUrl, metadata, ...(channels ? { channels } : {}), ...(split ? { split } : {}) }),
    signal: AbortSignal.timeout(10000),
  })
  const body = await response.json()
  if (!response.ok || !body.status) { console.error(`[payment:${providerName}] initialization rejected: ${body.message || 'unknown provider error'}`); throw new PaymentError('PAYMENT_INITIALIZATION_FAILED', body.message || 'Payment provider rejected initialization.', 502) }
  return { provider: providerName, reference, authorizationUrl: body.data.authorization_url, accessCode: body.data.access_code }
}

// Server-to-server confirmation used by the callback page and payment retries.
// Webhooks remain the primary signal; this never trusts anything the browser says.
export async function verifyPaystackTransaction(reference, { fetchImpl = globalThis.fetch } = {}) {
  const secret = process.env.PAYSTACK_SECRET_KEY
  if (!secret) throw new PaymentError('PAYMENT_PROVIDER_NOT_CONFIGURED', 'paystack credentials are missing.', 503)
  let response
  try {
    response = await fetchImpl(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(10000) })
  } catch {
    throw new PaymentError('PAYMENT_VERIFICATION_UNAVAILABLE', 'Payment provider could not be reached.', 502)
  }
  let body = null
  try { body = await response.json() } catch { body = null }
  if (response.status === 404 || (body && body.status === false && /not found/i.test(body.message || ''))) return { status: 'not_found', reference }
  if (!response.ok || !body?.status || !body.data) throw new PaymentError('PAYMENT_VERIFICATION_UNAVAILABLE', 'Payment provider did not confirm this transaction.', 502)
  const data = body.data
  return { status: data.status, reference: data.reference, amount: data.amount, currency: data.currency, id: data.id, gatewayResponse: data.gateway_response || null, paidAt: data.paid_at || null, authorization: data.authorization || null, channel: data.channel || null, customerEmail: data.customer?.email || null, metadata: typeof data.metadata === 'object' && data.metadata ? data.metadata : null, subaccountCode: data.subaccount?.subaccount_code || null, split: data.split && typeof data.split === 'object' ? data.split : null }
}

export function paystackMode() {
  const secret = process.env.PAYSTACK_SECRET_KEY || ''
  return secret.startsWith('sk_live_') ? 'live' : secret.startsWith('sk_test_') ? 'test' : secret ? 'unknown' : 'not_configured'
}

export function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.PAYSTACK_SECRET_KEY
  if (!secret || !signature || !Buffer.isBuffer(rawBody)) return false
  const expected = createHmac('sha512', secret).update(rawBody).digest('hex')
  const received = Buffer.from(signature)
  const actual = Buffer.from(expected)
  return received.length === actual.length && timingSafeEqual(received, actual)
}

export function matchesPaystackPayment(payment, event) {
  const data = event?.data
  return Boolean(data && data.reference === payment.reference && data.currency === 'NGN' && Number.isSafeInteger(data.amount) && data.amount === payment.amountMinor)
}

export function isOrderPayable(status) {
  return status === 'PENDING_PAYMENT' || status === 'PAID'
}

export class PaymentError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status }
}
