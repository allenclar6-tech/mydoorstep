# DOORSTEP Database Guide

## Database platform

The application uses PostgreSQL with Prisma as the object-relational mapper.

## Core design principles

- IDs use Prisma-generated IDs and stable relational keys
- Money is stored in minor units to avoid floating-point issues
- Access is role-scoped and protected by authorization checks
- Order and payment transitions are auditable

## Important models

- `User` — account identity, hashed password, role, status, verification metadata
- `Customer` — customer profile relationship
- `Restaurant` — partner business profile and approval state
- `RestaurantUser` — many-to-many user-to-restaurant access
- `Rider` — rider account, availability, and approval state
- `MenuCategory` — restaurant menu categories
- `MenuItem` — menu item and item metadata
- `Order` — order state, customer, restaurant, rider, totals, status
- `Payment` — payment lifecycle record
- `PaymentTransaction` — provider events and provider metadata
- `Notification` — customer and platform notifications
- `Review` — ratings and review content
- `SupportTicket` — customer support records and state
- `PlatformSetting` — commission and policy configuration
- `AuditLog` — administrative actions and sensitive changes

## Recommended operational rules

- Keep a managed Postgres instance in staging and production
- Run migrations through Prisma in CI and deployment pipelines
- Back up the database on a fixed schedule
- Add indexes for order lookup, rider lookup, and notification retrieval
- Record financial actions in a tamper-aware audit trail

## Local setup

1. Create a Postgres database.
2. Set `DATABASE_URL` in `.env`.
3. Run `npm.cmd run db:generate`.
4. Run `npm.cmd run db:push` for local schema sync, or use reviewed migrations for production.
5. Run `npm.cmd run db:seed` for development seed data.

## Production migration baseline

The existing production database predates committed Prisma migrations. The baseline
migration in `prisma/migrations/20261014114500_baseline_existing_schema` describes
that existing schema and must be marked as applied only after an operator verifies
that the target database matches it.

Do not run the baseline SQL against an existing database. From a secure deployment
environment with the production `DATABASE_URL` available:

1. Back up the database and verify the backup can be restored.
2. Compare the database with the baseline schema using `prisma migrate diff`.
3. If and only if there is no difference, mark the baseline as applied with:
   `npx prisma migrate resolve --applied 20261014114500_baseline_existing_schema`.
4. Run `npx prisma migrate deploy` to apply later reviewed migrations, including
   `20261014115500_add_rider_network`.
5. Verify `/api/ready`, rider delivery claims, and the application logs.

The rider-network migration is additive: current riders remain in the
`DOORSTEP_POOL`, while future `BUSINESS_OWNED` riders can be linked to one
restaurant or grocery business.

The restaurant-member-role migration is also additive. Existing business
members receive the `OWNER` role, while future memberships can use `MANAGER`,
`FINANCE`, or `STAFF`. Only Owners and Managers may manage business-owned
rider assignments.
