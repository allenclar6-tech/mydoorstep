import { createHmac, timingSafeEqual } from 'node:crypto'

const providers = {
  paystack: {
    initializeUrl: 'https://api.paystack.co/transaction/initialize',
    secret: () => process.env.PAYSTACK_SECRET_KEY,
  },
}

export async function initializePayment({ email, amountMinor, reference, callbackUrl, metadata = {} }) {
  const providerName = process.env.PAYMENT_PROVIDER || process.env.PAYMENTS_PROVIDER || 'paystack'
  const provider = providers[providerName]
  if (!provider) throw new PaymentError('PAYMENT_PROVIDER_UNSUPPORTED', `No adapter is configured for ${providerName}.`, 503)
  const secret = provider.secret()
  if (!secret) throw new PaymentError('PAYMENT_PROVIDER_NOT_CONFIGURED', `${providerName} credentials are missing.`, 503)

  const response = await fetch(provider.initializeUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, amount: amountMinor, reference, callback_url: callbackUrl, metadata }),
    signal: AbortSignal.timeout(10000),
  })
  const body = await response.json()
  if (!response.ok || !body.status) { console.error(`[payment:${providerName}] initialization rejected: ${body.message || 'unknown provider error'}`); throw new PaymentError('PAYMENT_INITIALIZATION_FAILED', body.message || 'Payment provider rejected initialization.', 502) }
  return { provider: providerName, reference, authorizationUrl: body.data.authorization_url, accessCode: body.data.access_code }
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
