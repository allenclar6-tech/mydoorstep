# DOORSTEP Project Audit

## Executive summary

The repository already contains a usable foundation for a production food-delivery marketplace in Sapele, Delta State, Nigeria. The app is split between a Vite + React customer-facing frontend and an Express + Prisma backend. That structure is workable for a real product, but the project still needs production discipline: managed PostgreSQL, real secrets, reviewed migrations, stricter domain controls, operational logging, and a deployment plan.

## Existing architecture

### Frontend
- Vite + React SPA in `src/`
- Route-based customer, restaurant, rider, and admin entry points
- Mobile-first UI with restaurant discovery, cart, checkout, login, and portal pages
- Local browser state for cart and some browse flows

### Backend
- Node.js Express API in `server/index.js`
- Prisma schema in `prisma/schema.prisma`
- Business logic spread across service modules: `auth.js`, `adminService.js`, `deliveryService.js`, `paymentService.js`, `uploadService.js`, `verificationService.js`, `aiBrain.js`
- Session, password hashing, verification, payment, and delivery logic are implemented server-side

### Database and data models
- PostgreSQL via Prisma
- User, restaurant, rider, menu, orders, delivery, payment, notification, support, promotion, and admin audit models are present
- Country, state, city, service-area, and delivery-zone models support Sapele-first operation with future expansion
- Money uses integer minor units in the backing models
- Seed data exists in `prisma/seed.js` for local development and Sapele delivery zones

### Security and platform basics
- Helmet and rate limiting in the API
- Zod validation for many endpoints
- Scrypt hashing and opaque session strategy
- Webhook verification and duplicate-event protection in payment logic
- Private upload validation for document intake
- API tests in `tests/api.test.js`

## Existing features already working

- Health and metadata endpoints
- Customer auth routes and public session checks
- Restaurant and rider application flows
- Support ticket and AI support endpoints
- Order validation and order creation flows
- Payment initialization and webhook verification patterns
- Delivery claim and status transition logic
- Admin application review endpoints
- Basic notification and unread-state handling
- Search and browsing surfaces for restaurants and foods
- Cart and checkout flow in the frontend

## Missing or incomplete production features

- No reviewed Prisma migration history committed for production use
- Migration history is not yet committed; the existing local database is unmanaged by Prisma Migrate
- Provider-backed operations, monitoring, and load measurements remain incomplete
- No production deployment config for Render, Railway, Vercel, Azure, or similar
- No central logging, metrics, error-monitoring, or alerting setup
- No managed object storage for private uploads
- No full provider integrations for email, SMS, Firebase, or map services
- No end-to-end test coverage for the full life cycles required by the prompt
- No business-ready settings UI for commissions, delivery fees, and platform policy
- No operating model for payout, review moderation, refund approval, or sponsor placements
- Customer discovery keeps a local fallback catalog for offline/local review, while live discovery now prefers the approved restaurant API; cart persistence remains browser-local until checkout

## Problems found

1. The project uses a mixed local-demo and real-backend pattern. Some screens look complete but still rely on in-memory or browser-only data.
2. `.env` and `.env.example` exist, but the example file does not match the production variable names in the prompt exactly.
3. The repo lacks some standard production files such as `.gitignore` and proper operational docs.
4. Local development secrets are present in `.env`; they are not safe to commit and should be treated as local-only.
5. Payment, maps, email, SMS, and notifications all need real provider configuration behind environment variables.
6. The app needs a migration and release process before production approval.
7. Address-level service-area validation still needs a geocoding/provider adapter; restaurant city eligibility is enforced server-side.

## Recommended architecture

### Frontend
- Continue with Vite + React for the web MVP
- Keep the API-first design with role-aware UI pages
- Use authenticated endpoints for all sensitive operations

### Backend
- Keep Express + Prisma as the core API layer
- Add a managed PostgreSQL database
- Wrap all business logic in service layers with explicit validation and transaction boundaries

### Payments
- Use Paystack as the default provider and keep the provider adapter configurable
- Keep secret keys on the server only
- Require signed webhook verification and idempotent payment processing

### Storage and notifications
- Use private object storage for uploads and Cloudinary/S3-compatible storage for public assets
- Add adapters for email, SMS, and push notifications behind a shared notification service

### Operations
- Use CI/CD, environment variable management, monitoring, and backups
- Add a launch checklist with QA results and runbook steps

## Planned implementation order

1. Lock down environment and secret handling
2. Add production docs and release checklist
3. Configure real PostgreSQL migration workflow
4. Review payment, delivery, and order flows for idempotency and auditing
5. Complete role-aware frontend integration with live API data
6. Harden notification and support flows
7. Add unit, integration, and E2E tests across finance and order journeys
8. Move to deployment with SSL, managed DB, and object storage

## Conclusion

The foundation is promising and already includes much of the core domain model. The next step is not a rewrite; it is to treat the application as a production-grade API-backed marketplace and complete the missing operational and security layers around the working code.
