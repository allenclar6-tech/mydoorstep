# DOORSTEP Architecture

## Overview

DOORSTEP is a marketplace for food discovery, ordering, delivery coordination, and administrative operations in Sapele, Nigeria. The application is designed around a single API layer that can support a web storefront and future mobile clients.

## Current stack

- Frontend: Vite + React
- Backend: Node.js + Express
- Database: PostgreSQL + Prisma ORM
- Auth: password hashing and revocable sessions
- Payments: Paystack-first configuration with provider abstraction
- Files: private uploads with validation before storage
- Monitoring: planned observability and alerting layer

## High-level flow

Customer -> Browse restaurants -> Add items to cart -> Checkout -> Payment init -> Order confirmed -> Restaurant workflow -> Rider assignment -> Delivery -> Review

## Role model

- Customer: discovery, cart, checkout, order tracking, reviews, profile
- Restaurant: onboarding, menu management, order acceptance, earnings, payouts
- Rider: onboarding, delivery claim, pickup, dropoff, earnings
- Admin: marketplace oversight, approval, financial management, platform settings

## API-first principles

- All order totals are produced server-side
- Payment verification is server-side only
- Restaurant and rider approval is enforced by authorization checks
- Sensitive operations require authenticated user context
- Provider keys and secret data remain server-side
- Public service-area configuration may use short-lived cache headers; authenticated and mutation responses are marked `no-store`

## File boundaries

- `src/` holds the frontend experience
- `server/` contains API routing and business service logic
- `prisma/` contains schema and seed data
- `tests/` contains validation tests
- `docs/` contains architecture, launch, and operational guidance

## Recommended next architecture improvements

- Move the frontend to live API-backed components for key workflows
- Add secure provider adapters for checkout, notifications, and uploads
- Add structured logging and environment-specific config
- Implement a production migration strategy with deployment automation
