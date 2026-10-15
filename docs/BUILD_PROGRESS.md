# DOORSTEP Build Progress

Legend: `[ ]` not started, `[~]` in progress, `[x]` complete, `[!]` blocked.

## Phases

- [x] Phase 1: Repository inspection and project audit
- [x] Phase 2: Architecture and production documentation
- [~] Phase 3: Database model and migration workflow; seven migrations are tracked, and the local database has all seven pending
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
- [x] Phase 25: Deployment; frontend is live on Cloudflare, API and production migrations are live on Render, and public readiness checks pass
- [~] Phase 26: Store preparation; checklists exist, no app submission is planned

## Current session: 2026-10-15

- Fixed dotenv startup precedence so host-injected environment variables are not replaced by local `.env` values.
- Added a regression test that proves precedence using an isolated temporary dotenv file.
- Added `pretest` to generate Prisma Client before running API tests.
- Removed the unused client-side `PAID` order creator, local order-history fallback, and unreachable confirmation panel; order screens now use API-backed records.
- Improved order history/tracking loading, retry, and error states; customer tracking data now returns the owning customer's total and payment status without exposing those fields to rider/admin sessions.
- Added unauthenticated-access regression coverage for order history and tracking.
- Added application review summaries and password confirmation to restaurant, grocery, and rider onboarding; the API now requires accepted terms and matching passwords before processing applications.
- Completed partner, grocery, and rider application details, with browser-tab draft resume that excludes passwords, verification codes, and files. The additive onboarding migration was applied during the production release.
- Wired the admin restaurant, grocery, and rider application queues to status/date/location/search filters, private document downloads, review notes, and approve/request-information/reject actions.
- Added application status tracking and a regression test rejecting client-supplied private document storage keys.
- Located the live Render production API and database. The latest API deploy failed because Prisma could not deserialize `to_regclass(...)` as a `regclass`; changed the baseline-existence query to cast the result to text.
- A production logical export is listed in Render as `.dir.tar.gz` but has not been downloaded. The separate point-in-time recovery copy `mydoorstep-db-staging` is available and has been migration-tested.
- The initial read-only staging comparison found the production schema lacked `StoreType`, `Restaurant.coverImageUrl`, and `Restaurant.storeType`. Corrected the baseline to match the restored schema and added an additive follow-up migration for those fields.
- A private, loopback-only staging worker verified the corrected baseline and all pending migrations on the isolated copy. The temporary worker and Blueprint were removed after verification.
- Updated `source-map-js` to a patched release. `npm audit --omit=dev` still reports three high advisories in `deepmerge-ts` via Prisma configuration; the suggested forced Prisma change is not a safe compatible update.
- Confirmed the Cloudflare production Worker forwards `/api/*` to the Render API, rather than hosting the API itself.
- Corrected audit/deployment documentation to match the tracked migration history, Render configuration, and existing `.gitignore`.
- Promoted `9c625ee` to `main`. Render's production API deploy succeeded; startup logged `migrations_ready`, `/api/health` returned `ok`, and `/api/ready` returned `ready` with database `ok`. The same-origin `/api/ready` route through `mydoorstep.com.co` also returned ready.
- Confirmed the public storefront loads at `https://mydoorstep.com.co`. The Render logical export remains available in Recovery but was not downloaded. Suspended `mydoorstep-db-staging` after production readiness passed; Render confirms suspended services are not billed.
- The configured local database still reports all seven tracked migrations pending; this does not reflect production, where the release startup migration completed successfully.

## Verified checks

- `npm.cmd test`: passed (33 tests).
- `npm.cmd run build`: passed; the main minified JavaScript chunk is about 2.36 MB (655 KB gzip), above the 500 KB advisory threshold.
- `npm.cmd run db:validate`: passed.
- `prisma validate --schema prisma/baseline.prisma`: passed.
- `npm.cmd run db:migrate:status`: connected to `localhost:5432`, found all seven tracked migrations unapplied, and exited with status 1. No schema changes were made.
- `npm.cmd audit --omit=dev`: three high findings remain in the Prisma configuration dependency chain; no forced major/toolchain change was applied.

## Current blockers

- Business-owned provider credentials and delivery integrations
- The local development database has all seven tracked migrations pending; do not mistake its status for production. The isolated recovery copy and production release both passed readiness.
- Address geocoding and out-of-area coordinate validation
- Final legal/business information
- Managed storage, monitoring, backups, and deployment accounts
- Payment, email/SMS, maps, and storage provider credentials and configuration
- Frontend JavaScript bundle exceeds the Vite advisory threshold

## Next safe work

After release, keep the production export available for recovery and leave the production-derived staging database suspended unless needed. Address remaining provider setup and dependency advisories, and continue monitoring API readiness.
