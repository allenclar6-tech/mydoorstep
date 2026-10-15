import { prisma } from '../server/prisma.js'

const baselineMigration = '20261014114500_baseline_existing_schema'

try {
  const [migrationTable] = await prisma.$queryRaw`SELECT to_regclass('public."_prisma_migrations"')::text AS migration_table`
  const migrations = migrationTable?.migration_table
    ? await prisma.$queryRaw`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name`
    : []
  const [users, restaurants, orders] = await Promise.all([
    prisma.user.count(),
    prisma.restaurant.count(),
    prisma.order.count(),
  ])
  const failedMigrations = migrations.filter((migration) => !migration.finished_at && !migration.rolled_back_at).length

  console.info('[staging] read-only preflight', JSON.stringify({
    baselineRecorded: migrations.some((migration) => migration.migration_name === baselineMigration && migration.finished_at && !migration.rolled_back_at),
    recordedMigrationCount: migrations.length,
    failedMigrationCount: failedMigrations,
    rowCounts: { users, restaurants, orders },
  }))

  if (users === 0) throw new Error('Staging database contains no users; refusing migration verification.')
  if (failedMigrations > 0) throw new Error('Staging database has unfinished migrations; investigate before proceeding.')
} finally {
  await prisma.$disconnect()
}
