import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { prisma } from './prisma.js'

const execFileAsync = promisify(execFile)
const baselineMigration = '20261014114500_baseline_existing_schema'
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const baselineSchema = join(root, 'prisma', 'baseline.prisma')
// Run the CLI's JS entry with this Node binary: spawning prisma.cmd fails with EINVAL on Windows.
const prismaCli = join(root, 'node_modules', 'prisma', 'build', 'index.js')

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for migrations.')

async function runPrisma(args) {
  await execFileAsync(process.execPath, [prismaCli, ...args], { cwd: root, env: process.env })
}

async function isBaselineRecorded() {
  const tables = await prisma.$queryRaw`SELECT to_regclass('public."_prisma_migrations"')::text AS migration_table`
  if (!tables[0]?.migration_table) return false
  const migrations = await prisma.$queryRaw`SELECT 1 FROM "_prisma_migrations" WHERE migration_name = ${baselineMigration} LIMIT 1`
  return migrations.length === 1
}

async function ensureBaseline() {
  if (await isBaselineRecorded()) return
  try {
    await runPrisma(['migrate', 'diff', '--from-url', process.env.DATABASE_URL, '--to-schema-datamodel', baselineSchema, '--exit-code'])
  } catch (error) {
    if (error.code === 2) throw new Error('Production database does not match the reviewed baseline. Refusing to apply migrations.')
    throw error
  }
  await runPrisma(['migrate', 'resolve', '--applied', baselineMigration])
}

try {
  await ensureBaseline()
  await runPrisma(['migrate', 'deploy'])
  console.info('[database] migrations_ready')
} finally {
  await prisma.$disconnect()
}
