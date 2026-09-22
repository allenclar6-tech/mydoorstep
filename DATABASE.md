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
