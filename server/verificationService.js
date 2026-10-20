import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import { prisma } from './prisma.js'

const ttlMs = 10 * 60 * 1000
const maxAttempts = 5
export const RESEND_COOLDOWN_MS = 60 * 1000
export const MAX_CODES_PER_HOUR = 5
const providerRequestTimeoutMs = 15_000
const resendEmailUrl = 'https://api.resend.com/emails'
const hashCode = (code) => createHash('sha256').update(code).digest('hex')

function verificationError(code, status) {
  return Object.assign(new Error(code), { code, status })
}

function logVerification(event, details = {}) {
  console.info('[verification]', JSON.stringify({ event, ...details }))
}

async function deliverEmailCode(destination, code, fetchImpl) {
  if (process.env.EMAIL_PROVIDER && process.env.EMAIL_PROVIDER !== 'resend') throw verificationError('EMAIL_VERIFICATION_PROVIDER_UNSUPPORTED', 503)
  if (!process.env.RESEND_API_KEY || !process.env.VERIFICATION_FROM_EMAIL) throw verificationError('EMAIL_VERIFICATION_NOT_CONFIGURED', 503)

  let providerResponse
  try {
    providerResponse = await fetchImpl(resendEmailUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(providerRequestTimeoutMs),
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.VERIFICATION_FROM_EMAIL,
        to: [destination],
        subject: 'Your DOORSTEP verification code',
        text: `Your DOORSTEP verification code is ${code}. It expires in 10 minutes. If you did not request this code, you can ignore this email.`,
      }),
    })
  } catch (error) {
    logVerification('email_delivery_network_error', { errorName: error?.name || 'Error' })
    throw verificationError('VERIFICATION_SERVICE_UNAVAILABLE', 503)
  }

  if (!providerResponse.ok) {
    const code = providerResponse.status === 429 ? 'EMAIL_VERIFICATION_RATE_LIMITED' : 'VERIFICATION_SERVICE_UNAVAILABLE'
    logVerification('email_delivery_rejected', { providerStatus: providerResponse.status, code })
    throw verificationError(code, providerResponse.status === 429 ? 429 : 503)
  }
}

export const smsProvider = () => (process.env.SMS_PROVIDER || (process.env.TERMII_API_KEY ? 'termii' : 'twilio')).toLowerCase()
export function smsConfigured() {
  if (smsProvider() === 'termii') return Boolean(process.env.TERMII_API_KEY && process.env.TERMII_BASE_URL && process.env.TERMII_SENDER_ID)
  if (smsProvider() === 'twilio') return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER)
  return false
}
export const whatsappConfigured = () => Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_AUTH_TEMPLATE)
export const emailConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.VERIFICATION_FROM_EMAIL && (!process.env.EMAIL_PROVIDER || process.env.EMAIL_PROVIDER === 'resend'))

async function providerFetch(url, init, failureCode, event, fetchImpl) {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(providerRequestTimeoutMs) })
  } catch (error) {
    logVerification(event, { errorName: error?.name || 'Error' })
    throw verificationError(failureCode, 503)
  }
}

async function deliverSmsCode(destination, code, fetchImpl) {
  const provider = smsProvider()
  if (!['twilio', 'termii'].includes(provider)) throw verificationError('SMS_VERIFICATION_PROVIDER_UNSUPPORTED', 503)
  if (!smsConfigured()) throw verificationError('SMS_VERIFICATION_NOT_CONFIGURED', 503)
  const text = `Your DOORSTEP verification code is ${code}. It expires in 10 minutes. Never share this code.`

  if (provider === 'termii') {
    // Termii "Send message" API; the DND route is needed to reach Nigerian numbers on Do-Not-Disturb.
    const base = process.env.TERMII_BASE_URL.replace(/\/+$/, '')
    const providerResponse = await providerFetch(`${base}/api/sms/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: process.env.TERMII_API_KEY, to: destination.replace(/^\+/, ''), from: process.env.TERMII_SENDER_ID, sms: text, type: 'plain', channel: process.env.TERMII_CHANNEL || 'dnd' }),
    }, 'SMS_VERIFICATION_UNAVAILABLE', 'sms_delivery_network_error', fetchImpl)
    const body = await providerResponse.json().catch(() => null)
    if (!providerResponse.ok || body?.code !== 'ok') {
      const failure = providerResponse.status === 429 ? 'SMS_VERIFICATION_RATE_LIMITED' : 'SMS_VERIFICATION_UNAVAILABLE'
      logVerification('sms_delivery_rejected', { provider, providerStatus: providerResponse.status, code: failure })
      throw verificationError(failure, providerResponse.status === 429 ? 429 : 503)
    }
    return
  }

  const accountId = encodeURIComponent(process.env.TWILIO_ACCOUNT_SID)
  const authorization = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')
  const providerResponse = await providerFetch(`https://api.twilio.com/2010-04-01/Accounts/${accountId}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${authorization}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: destination, From: process.env.TWILIO_FROM_NUMBER, Body: text }),
  }, 'SMS_VERIFICATION_UNAVAILABLE', 'sms_delivery_network_error', fetchImpl)
  if (!providerResponse.ok) {
    const failure = providerResponse.status === 429 ? 'SMS_VERIFICATION_RATE_LIMITED' : 'SMS_VERIFICATION_UNAVAILABLE'
    logVerification('sms_delivery_rejected', { provider, providerStatus: providerResponse.status, code: failure })
    throw verificationError(failure, providerResponse.status === 429 ? 429 : 503)
  }
}

/**
 * WhatsApp codes use Meta's WhatsApp Cloud API with an approved AUTHENTICATION template (copy-code button).
 * The code goes in both the body and the button parameter, as Meta's documentation requires.
 */
async function deliverWhatsAppCode(destination, code, fetchImpl) {
  if (!whatsappConfigured()) throw verificationError('WHATSAPP_VERIFICATION_NOT_CONFIGURED', 503)
  const version = process.env.WHATSAPP_GRAPH_VERSION || 'v26.0'
  const providerResponse = await providerFetch(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(process.env.WHATSAPP_PHONE_NUMBER_ID)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: destination.replace(/^\+/, ''), type: 'template',
      template: {
        name: process.env.WHATSAPP_AUTH_TEMPLATE,
        language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
        ],
      },
    }),
  }, 'WHATSAPP_VERIFICATION_UNAVAILABLE', 'whatsapp_delivery_network_error', fetchImpl)
  const body = await providerResponse.json().catch(() => null)
  if (!providerResponse.ok || !body?.messages?.[0]?.id) {
    const failure = providerResponse.status === 429 ? 'WHATSAPP_VERIFICATION_RATE_LIMITED' : 'WHATSAPP_VERIFICATION_UNAVAILABLE'
    // Meta error codes help diagnose template/number problems and contain no personal data.
    logVerification('whatsapp_delivery_rejected', { providerStatus: providerResponse.status, metaCode: body?.error?.code || null, code: failure })
    throw verificationError(failure, providerResponse.status === 429 ? 429 : 503)
  }
}

export function verificationFailure(error) {
  const knownFailures = new Set([
    'EMAIL_VERIFICATION_NOT_CONFIGURED',
    'EMAIL_VERIFICATION_PROVIDER_UNSUPPORTED',
    'EMAIL_VERIFICATION_RATE_LIMITED',
    'PHONE_VERIFICATION_NOT_CONFIGURED',
    'SMS_VERIFICATION_NOT_CONFIGURED',
    'SMS_VERIFICATION_PROVIDER_UNSUPPORTED',
    'SMS_VERIFICATION_RATE_LIMITED',
    'SMS_VERIFICATION_UNAVAILABLE',
    'VERIFICATION_SERVICE_UNAVAILABLE',
    'WHATSAPP_VERIFICATION_NOT_CONFIGURED',
    'WHATSAPP_VERIFICATION_UNAVAILABLE',
    'WHATSAPP_VERIFICATION_RATE_LIMITED',
    'VERIFICATION_COOLDOWN',
    'VERIFICATION_HOURLY_LIMIT',
  ])
  if (knownFailures.has(error?.code)) return { code: error.code, status: error.status || 503, ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}) }
  return { code: 'VERIFICATION_SERVICE_UNAVAILABLE', status: 503 }
}

export async function issueVerificationCode({ destination, channel }, { db = prisma, fetchImpl = (...args) => globalThis.fetch(...args), now: clock = null } = {}) {
  const normalizedDestination = destination.toLowerCase()
  const code = String(randomInt(100000, 1000000))
  const now = clock || new Date()
  const expiresAt = new Date(now.getTime() + ttlMs)

  // Resend cooldown and hourly cap per destination, on top of the per-IP rate limit.
  const recent = await db.verificationCode.findMany({ where: { destination: normalizedDestination, channel, createdAt: { gt: new Date(now.getTime() - 60 * 60 * 1000) } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true }, take: MAX_CODES_PER_HOUR })
  if (recent[0] && now.getTime() - recent[0].createdAt.getTime() < RESEND_COOLDOWN_MS) {
    throw Object.assign(verificationError('VERIFICATION_COOLDOWN', 429), { retryAfterSeconds: Math.ceil((RESEND_COOLDOWN_MS - (now.getTime() - recent[0].createdAt.getTime())) / 1000) })
  }
  if (recent.length >= MAX_CODES_PER_HOUR) throw Object.assign(verificationError('VERIFICATION_HOURLY_LIMIT', 429), { retryAfterSeconds: 3600 })

  await db.verificationCode.updateMany({
    where: { destination: normalizedDestination, channel, verifiedAt: null, expiresAt: { gt: now } },
    data: { attempts: maxAttempts },
  })

  const challenge = await db.verificationCode.create({
    data: { destination: normalizedDestination, channel, codeHash: hashCode(code), expiresAt },
  })

  try {
    if (channel === 'phone') await deliverSmsCode(normalizedDestination, code, fetchImpl)
    else if (channel === 'whatsapp') await deliverWhatsAppCode(normalizedDestination, code, fetchImpl)
    else await deliverEmailCode(normalizedDestination, code, fetchImpl)
    logVerification('delivery_accepted', { channel })
    return { challengeId: challenge.id, expiresAt: challenge.expiresAt }
  } catch (error) {
    try {
      await db.verificationCode.delete({ where: { id: challenge.id } })
    } catch (cleanupError) {
      logVerification('challenge_cleanup_failed', { errorName: cleanupError?.name || 'Error' })
    }
    throw error
  }
}

export async function verifyCode({ challengeId, destination, code, channels = null }, { db = prisma, now = new Date() } = {}) {
  const challenge = await db.verificationCode.findUnique({ where: { id: challengeId } })
  if (!challenge || (channels && !channels.includes(challenge.channel)) || challenge.destination !== destination.toLowerCase() || challenge.verifiedAt || challenge.expiresAt <= now || challenge.attempts >= maxAttempts) return false

  const valid = timingSafeEqual(Buffer.from(hashCode(String(code))), Buffer.from(challenge.codeHash))
  // Conditional write: two requests racing with the same code cannot both succeed.
  const updated = await db.verificationCode.updateMany({
    where: { id: challenge.id, verifiedAt: null, attempts: { lt: maxAttempts } },
    data: { attempts: { increment: 1 }, ...(valid ? { verifiedAt: now } : {}) },
  })
  return valid && updated.count === 1
}
