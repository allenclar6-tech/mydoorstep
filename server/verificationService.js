import { createHash, randomInt } from 'node:crypto'
import { prisma } from './prisma.js'

const ttlMs = 10 * 60 * 1000
const hashCode = (code) => createHash('sha256').update(code).digest('hex')

async function sendEmailCode(destination, code) {
  if (!process.env.RESEND_API_KEY || !process.env.VERIFICATION_FROM_EMAIL) throw Object.assign(new Error('Email verification is not configured.'), { code: 'EMAIL_VERIFICATION_NOT_CONFIGURED' })
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.VERIFICATION_FROM_EMAIL, to: [destination], subject: 'Your DOORSTEP verification code', text: `Your DOORSTEP verification code is ${code}. It expires in 10 minutes.` }),
  })
  if (!response.ok) throw Object.assign(new Error('Email verification could not be delivered.'), { code: 'EMAIL_VERIFICATION_DELIVERY_FAILED' })
}

async function sendSmsCode(destination, code) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) throw Object.assign(new Error('SMS verification is not configured.'), { code: 'SMS_VERIFICATION_NOT_CONFIGURED' })
  const credentials = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')
  const body = new URLSearchParams({ To: destination, From: TWILIO_FROM_NUMBER, Body: `Your DOORSTEP verification code is ${code}. It expires in 10 minutes.` })
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, { method: 'POST', headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body })
  if (!response.ok) throw Object.assign(new Error('SMS verification could not be delivered.'), { code: 'SMS_VERIFICATION_DELIVERY_FAILED' })
}

export async function issueVerificationCode({ destination, channel }) {
  const code = String(randomInt(100000, 1000000))
  if (channel === 'email' || channel === 'password_reset') await sendEmailCode(destination, code)
  else if (channel === 'phone') await sendSmsCode(destination, code)
  const challenge = await prisma.verificationCode.create({ data: { destination: destination.toLowerCase(), channel, codeHash: hashCode(code), expiresAt: new Date(Date.now() + ttlMs) } })
  return { challengeId: challenge.id, expiresAt: challenge.expiresAt, developmentCode: process.env.NODE_ENV === 'production' ? undefined : code }
}

export async function verifyCode({ challengeId, destination, code }) {
  const challenge = await prisma.verificationCode.findUnique({ where: { id: challengeId } })
  if (!challenge || challenge.destination !== destination.toLowerCase() || challenge.verifiedAt || challenge.expiresAt <= new Date() || challenge.attempts >= 5) return false
  await prisma.verificationCode.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 }, ...(hashCode(code) === challenge.codeHash ? { verifiedAt: new Date() } : {}) } })
  return hashCode(code) === challenge.codeHash
}
