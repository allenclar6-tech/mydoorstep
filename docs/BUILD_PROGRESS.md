# DOORSTEP Build Progress

Legend: `[ ]` not started, `[~]` in progress, `[x]` complete, `[!]` blocked.

## Phases

- [x] Phase 1: Repository inspection and project audit
- [x] Phase 2: Architecture and production documentation
- [~] Phase 3: Database model and migration workflow; six migrations are tracked, and the configured local database has all six pending
- [x] Phase 4: Authentication foundation and role gates
- [~] Phase 5: Customer experience; discovery, cart, checkout, account, support, and tracking exist
- [~] Phase 6: Restaurant system; approval, menu, orders, profile, summary, and opening-hour enforcement exist
- [~] Phase 7: Rider system; approval, availability, delivery, history, and earnings APIs/UI exist
- [~] Phase 8: Admin system; login, approvals, support, and partial operations UI exist
- [~] Phase 9: Cart and checkout; server order creation, totals, and idempotency protection are implemented
- [~] Phase 10: Test-mode payments; Paystack adapter and signed reconciliation exist, credentials are not configured
- [~] Phase 11: Orders and strict transitions; conditional updates and webhook confirmation exist
- [~] Phase 12: Service areas and delivery zones; Sapele is data-driven and enabled, address geocoding and distance pricing remain
- [!] Phase 13: Maps; provider credentials and distance/ETA adapter are not configured
- [~] Phase 14: Notifications; in-app flow exists, email/SMS/push adapters remain
- [~] Phase 15: Reviews; delivered-order review API, duplicate protection, and rating aggregation exist, customer UI remains
- [ ] Phase 16: Coupons and promotions
- [~] Phase 17: Support; tickets, messages, AI replies, and admin inbox exist
- [~] Phase 18: Security; validation, rate limits, headers, sessions, uploads, and webhook checks exist
- [~] Phase 19: Performance; indexes and pagination foundations exist, caching/load measurement remain
- [~] Phase 20: Testing; API suite exists, end-to-end and lifecycle coverage remain
- [~] Phase 21: Load testing preparation; plan documented, measurements not run
- [~] Phase 22: SEO/accessibility; semantic routes exist, formal audit remains
- [ ] Phase 23: PWA readiness
- [x] Phase 24: Mobile API readiness; backend is independently exposed through documented APIs
- [~] Phase 25: Deployment preparation; frontend is live on Cloudflare and API is live on Render, while safe migration verification and provider setup remain
- [~] Phase 26: Store preparation; checklists exist, no app submission is planned

## Current session: 2026-10-15

- Fixed dotenv startup precedence so host-injected environment variables are not replaced by local `.env` values.
- Added a regression test that proves precedence using an isolated temporary dotenv file.
- Added `pretest` to generate Prisma Client before running API tests.
- Removed the unused client-side `PAID` order creator, local order-history fallback, and unreachable confirmation panel; order screens now use API-backed records.
- Improved order history/tracking loading, retry, and error states; customer tracking data now returns the owning customer's total and payment status without exposing those fields to rider/admin sessions.
- Added unauthenticated-access regression coverage for order history and tracking.
- Added application review summaries and password confirmation to restaurant, grocery, and rider onboarding; the API now requires accepted terms and matching passwords before processing applications.
- Completed partner, grocery, and rider application details, with browser-tab draft resume that excludes passwords, verification codes, and files. Added the additive onboarding migration; it has not been applied.
- Wired the admin restaurant, grocery, and rider application queues to status/date/location/search filters, private document downloads, review notes, and approve/request-information/reject actions.
- Added application status tracking and a regression test rejecting client-supplied private document storage keys.
- Located the live Render production API and database. The latest API deploy failed because Prisma could not deserialize `to_regclass(...)` as a `regclass`; changed the baseline-existence query to cast the result to text.
- The Render Recovery page now lists a production logical export as `.dir.tar.gz`; it has not been downloaded or independently restore-tested. A point-in-time recovery copy named `mydoorstep-db-staging` is still `Recovery In Progress`, and no staging credentials or migration checks are available yet.
- Confirmed the Cloudflare production Worker forwards `/api/*` to the Render API, rather than hosting the API itself.
- Corrected audit/deployment documentation to match the tracked migration history, Render configuration, and existing `.gitignore`.
- No migration was applied; the configured local database reports all six migrations pending. Do not apply them until the existing database schema and backup are verified.
- No API or database changes were deployed. The Render API's prior deployment remains healthy and `/api/ready` currently reports ready; its latest deployment is failed and has not been retried. The Render frontend service has a valid `Dockerfile.web`; Wrangler is not installed locally, and no GitHub Actions deployment workflow is configured.

## Verified checks

- `npm.cmd test`: passed (33 tests).
- `npm.cmd run build`: passed; the main minified JavaScript chunk is about 2.36 MB (655 KB gzip), above the 500 KB advisory threshold.
- `npm.cmd run db:validate`: passed.
- `npm.cmd run db:migrate:status`: connected to `localhost:5432`, found all six tracked migrations unapplied, and exited with status 1. No schema changes were made.

## Current blockers

- Business-owned provider credentials and delivery integrations
- Staging/production Prisma migration state is unknown; the local database has all six tracked migrations pending. Wait for the isolated recovery copy, verify its baseline/schema and migration state, then test migrations and API readiness before any production release.
- Address geocoding and out-of-area coordinate validation
- Final legal/business information
- Managed storage, monitoring, backups, and deployment accounts
- Deployment access, provider credential validation, and a verified frontend/API deployment configuration
- Frontend JavaScript bundle exceeds the Vite advisory threshold

## Next safe work

Do not run migrations while the staging recovery is in progress. When it is available, verify the restored schema and migration history against the baseline, apply pending migrations only to that isolated copy, and smoke-test the staging API. Retry the production deployment only after those checks pass and the listed production export is securely downloaded.
