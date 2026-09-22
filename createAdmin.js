import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from './auth.js'

const email = process.env.ADMIN_EMAIL
const password = process.env.ADMIN_PASSWORD
const firstName = process.env.ADMIN_FIRST_NAME || 'DOORSTEP'
const lastName = process.env.ADMIN_LAST_NAME || 'Owner'

if (!email || !password) {
  console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD before running this command.')
  process.exit(1)
}

const prisma = new PrismaClient()
try {
  const user = await prisma.user.upsert({ where: { email: email.toLowerCase() }, update: { passwordHash: await hashPassword(password), firstName, lastName, role: 'ADMIN', status: 'ACTIVE' }, create: { email: email.toLowerCase(), passwordHash: await hashPassword(password), firstName, lastName, role: 'ADMIN', status: 'ACTIVE' } })
  console.log(`Admin account ready: ${user.email}`)
} finally {
  await prisma.$disconnect()
}
