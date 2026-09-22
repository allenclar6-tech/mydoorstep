# DOORSTEP Build Progress

Legend: `[ ]` not started, `[~]` in progress, `[x]` complete, `[!]` blocked.

## Phases

- [x] Phase 1: Repository inspection and project audit
- [x] Phase 2: Architecture and production documentation
- [~] Phase 3: Database model and migration workflow; schema exists, migration history is not committed
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
- [~] Phase 25: Deployment preparation; docs and scripts exist, migration/provider setup remains
- [~] Phase 25: Deployment preparation; frontend is live on Cloudflare, API hosting and migration/provider setup remain
- [~] Phase 26: Store preparation; checklists exist, no app submission is planned

## Verified checks

- `node --test tests/api.test.js`: passing
- `npm.cmd run build`: passing
- `npm.cmd run db:validate`: passing
- `npm.cmd run db:migrate:status`: database reachable, no migration history found

## Current blockers

- Business-owned provider credentials and delivery integrations
- Reviewed Prisma migration/baseline
- Address geocoding and out-of-area coordinate validation
- Final legal/business information
- Managed storage, monitoring, backups, and deployment accounts
