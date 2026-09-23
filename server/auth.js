import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { prisma } from './prisma.js'

const scrypt = promisify(scryptCallback)
const SESSION_DAYS = 30

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const derivedKey = await scrypt(password, salt, 64)
  return `${salt}:${Buffer.from(derivedKey).toString('hex')}`
}

export async function verifyPassword(password, storedHash) {
  const [salt, key] = storedHash.split(':')
  if (!salt || !key) return false
  const derivedKey = await scrypt(password, salt, 64)
  const expected = Buffer.from(key, 'hex')
  return expected.length === derivedKey.length && timingSafeEqual(expected, derivedKey)
}

export async function createSession(userId) {
  const token = randomBytes(32).toString('hex')
  await prisma.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000) } })
  return token
}

export async function requireUser(request, response, next) {
  const header = request.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return response.status(401).json({ error: 'AUTHENTICATION_REQUIRED' })

  try {
    const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: { include: { rider: true } } } })
    if (!session || session.expiresAt <= new Date() || session.user.status !== 'ACTIVE') return response.status(401).json({ error: 'SESSION_INVALID' })
    request.user = session.user
    request.sessionId = session.id
    return next()
  } catch (error) {
    return response.status(503).json({ error: 'AUTH_SERVICE_UNAVAILABLE' })
  }
}

export async function revokeSession(sessionId) {
  await prisma.session.delete({ where: { id: sessionId } }).catch(() => undefined)
}

export async function revokeUserSessions(userId) {
  await prisma.session.deleteMany({ where: { userId } })
}
