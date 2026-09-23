import { createHash, randomInt } from 'node:crypto'
import { prisma } from './prisma.js'

const ttlMs = 10 * 60 * 1000
const hashCode = (code) => createHash('sha256').update(code).digest('hex')

export async function issueVerificationCode({ destination, channel }) {
  const code = String(randomInt(100000, 1000000))
  const challenge = await prisma.verificationCode.create({ data: { destination: destination.toLowerCase(), channel, codeHash: hashCode(code), expiresAt: new Date(Date.now() + ttlMs) } })
  // Replace this development transport with the business SMTP/SMS provider adapter.
  console.log(`[verification:${channel}] ${destination} code=${code}`)
  return { challengeId: challenge.id, expiresAt: challenge.expiresAt, developmentCode: process.env.NODE_ENV === 'production' ? undefined : code }
}

export async function verifyCode({ challengeId, destination, code }) {
  const challenge = await prisma.verificationCode.findUnique({ where: { id: challengeId } })
  if (!challenge || challenge.destination !== destination.toLowerCase() || challenge.verifiedAt || challenge.expiresAt <= new Date() || challenge.attempts >= 5) return false
  await prisma.verificationCode.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 }, ...(hashCode(code) === challenge.codeHash ? { verifiedAt: new Date() } : {}) } })
  return hashCode(code) === challenge.codeHash
}
