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

## Implemented foundation (verification varies by feature)

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

- A Prisma migration history is committed (one baseline and six follow-up migrations); the restored staging schema now matches the corrected baseline and passed the migration/readiness check
- Provider-backed operations, monitoring, and load measurements remain incomplete
- Render API and web service configuration exists; production deployment and domain health have not been verified in this audit
- No central logging, metrics, error-monitoring, or alerting setup
- Private uploads use local filesystem storage; durable private object storage and malware scanning are not implemented
- Paystack payment initialization/webhook code, Resend email verification, Twilio SMS verification, and Google Places endpoints are implemented; provider credentials and live delivery have not been verified. Flutterwave payments, Firebase push, and managed object-storage integration remain unverified or missing.
- No end-to-end test coverage for the full life cycles required by the prompt
- No business-ready settings UI for commissions, delivery fees, and platform policy
- No operating model for payout, review moderation, refund approval, or sponsor placements
- Customer discovery keeps a local fallback catalog for offline/local review, while live discovery now prefers the approved restaurant API; cart persistence remains browser-local until checkout

## Problems found

1. Server startup used `dotenv.config({ override: true })`, allowing a local `.env` value to replace a secret or setting injected by the host. This was changed to dotenv's default host-environment precedence and covered by an isolated regression test.
2. Local environment files exist, but `.gitignore` excludes them and none of `.env`, `.env.local`, `.env.production`, or `.env.TXT` is tracked by Git. Their values were not printed or reviewed.
3. Prisma migration SQL is tracked in Git, but a read-only status check against the configured local database (`localhost:5432`) found all five migrations unapplied. No migration was applied; staging and production database state are unknown.
4. Initial API test execution failed before tests loaded because Prisma Client had not been generated. `pretest` now runs `prisma generate`; the regression suite now passes.
5. The production frontend build succeeded but emitted a warning for a minified JavaScript chunk of approximately 2.34 MB (649 KB gzip), above Vite's 500 KB advisory threshold.
6. Provider key presence alone does not prove credentials are valid or an integration works. Production credentials and end-to-end provider verification remain unconfirmed.
7. Address-level service-area validation still needs a geocoding/provider adapter; restaurant city eligibility is enforced server-side.
8. Legacy frontend code could create client-local orders with `PAID` status, and order pages used local storage as a fallback. That path and its unreachable confirmation panel have been removed; order history and tracking now rely on API-backed orders only. A payment-pending order no longer displays a confirmed-payment timeline.
9. The order history previously rendered an empty result when its API request failed, and the tracking endpoint omitted the customer's total/payment status needed by the page. The frontend now presents explicit loading/error/retry states; the authenticated customer tracking response includes only that customer's order total and payment status, and focused unauthenticated access tests cover both routes.

## Evidence collected in this audit

- `npm.cmd run build`: passed before and after the order-history fix; Vite reported the large JavaScript chunk warning above.
- `npm.cmd run db:validate`: passed.
- `npm.cmd test`: passed, 29/29 tests, including deployment environment precedence; `pretest` generated Prisma Client.
- `npm.cmd run db:migrate:status`: connected to local PostgreSQL at `localhost:5432` and exited nonzero because all five tracked migrations are pending; no migration was deployed or applied.
- `prisma/migrations/` contains five tracked migrations, including `20261014114500_baseline_existing_schema`; production migration state remains unknown.
- Git confirms local `.env*` files are ignored and not tracked. Only environment-variable names and whether they were populated were checked; values were not revealed.
- Deployment readiness check: Wrangler is absent from `node_modules`, this session has no Cloudflare/Render credential environment variables, and there are no GitHub Actions workflows in the repository. A valid frontend `Dockerfile.web` is now present for the Render service, but no live deployment or credential-backed production release was attempted.

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
