import { createHash, randomInt } from 'node:crypto'
import { prisma } from './prisma.js'

const ttlMs = 10 * 60 * 1000
const maxAttempts = 5
const resendEmailUrl = 'https://api.resend.com/emails'
const hashCode = (code) => createHash('sha256').update(code).digest('hex')

function verificationError(code, status) {
  return Object.assign(new Error(code), { code, status })
}

function logVerification(event, details = {}) {
  console.info('[verification]', JSON.stringify({ event, ...details }))
}

async function deliverEmailCode(destination, code) {
  if (process.env.EMAIL_PROVIDER && process.env.EMAIL_PROVIDER !== 'resend') throw verificationError('EMAIL_VERIFICATION_PROVIDER_UNSUPPORTED', 503)
  if (!process.env.RESEND_API_KEY || !process.env.VERIFICATION_FROM_EMAIL) throw verificationError('EMAIL_VERIFICATION_NOT_CONFIGURED', 503)

  let providerResponse
  try {
    providerResponse = await fetch(resendEmailUrl, {
      method: 'POST',
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

async function deliverSmsCode(destination, code) {
  if (process.env.SMS_PROVIDER && process.env.SMS_PROVIDER !== 'twilio') throw verificationError('SMS_VERIFICATION_PROVIDER_UNSUPPORTED', 503)
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_FROM_NUMBER) throw verificationError('SMS_VERIFICATION_NOT_CONFIGURED', 503)

  const accountId = encodeURIComponent(process.env.TWILIO_ACCOUNT_SID)
  const authorization = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')
  let providerResponse
  try {
    providerResponse = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountId}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authorization}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: destination,
        From: process.env.TWILIO_FROM_NUMBER,
        Body: `Your DOORSTEP verification code is ${code}. It expires in 10 minutes.`,
      }),
    })
  } catch (error) {
    logVerification('sms_delivery_network_error', { errorName: error?.name || 'Error' })
    throw verificationError('SMS_VERIFICATION_UNAVAILABLE', 503)
  }

  if (!providerResponse.ok) {
    const code = providerResponse.status === 429 ? 'SMS_VERIFICATION_RATE_LIMITED' : 'SMS_VERIFICATION_UNAVAILABLE'
    logVerification('sms_delivery_rejected', { providerStatus: providerResponse.status, code })
    throw verificationError(code, providerResponse.status === 429 ? 429 : 503)
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
  ])
  if (knownFailures.has(error?.code)) return { code: error.code, status: error.status || 503 }
  return { code: 'VERIFICATION_SERVICE_UNAVAILABLE', status: 503 }
}

export async function issueVerificationCode({ destination, channel }) {
  const normalizedDestination = destination.toLowerCase()
  const code = String(randomInt(100000, 1000000))
  const expiresAt = new Date(Date.now() + ttlMs)
  const now = new Date()

  await prisma.verificationCode.updateMany({
    where: { destination: normalizedDestination, channel, verifiedAt: null, expiresAt: { gt: now } },
    data: { attempts: maxAttempts },
  })

  const challenge = await prisma.verificationCode.create({
    data: { destination: normalizedDestination, channel, codeHash: hashCode(code), expiresAt },
  })

  try {
    if (channel === 'phone') await deliverSmsCode(normalizedDestination, code)
    else await deliverEmailCode(normalizedDestination, code)
    logVerification('delivery_accepted', { channel })
    return { challengeId: challenge.id, expiresAt: challenge.expiresAt }
  } catch (error) {
    try {
      await prisma.verificationCode.delete({ where: { id: challenge.id } })
    } catch (cleanupError) {
      logVerification('challenge_cleanup_failed', { errorName: cleanupError?.name || 'Error' })
    }
    throw error
  }
}

export async function verifyCode({ challengeId, destination, code }) {
  const challenge = await prisma.verificationCode.findUnique({ where: { id: challengeId } })
  if (!challenge || challenge.destination !== destination.toLowerCase() || challenge.verifiedAt || challenge.expiresAt <= new Date() || challenge.attempts >= maxAttempts) return false

  const valid = hashCode(code) === challenge.codeHash
  await prisma.verificationCode.update({
    where: { id: challenge.id },
    data: { attempts: { increment: 1 }, ...(valid ? { verifiedAt: new Date() } : {}) },
  })
  return valid
}
