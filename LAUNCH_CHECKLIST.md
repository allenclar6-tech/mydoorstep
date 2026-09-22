# DOORSTEP Launch Checklist

## Foundation
- [ ] PostgreSQL database is provisioned and reachable
- [ ] Prisma schema is reviewed and migration strategy is approved
- [ ] Existing database is baselined or an initial reviewed Prisma migration is committed
- [ ] `.env` is configured for all required production variables
- [ ] Secrets are stored in environment management, not source control
- [ ] `.gitignore` blocks `.env` and local secret files

## Security
- [ ] Password hashing and auth are verified in production
- [ ] Role-based auth checks are in place for admin and operational routes
- [ ] Webhooks and callbacks are signature-verified
- [ ] Private upload validation and file-size limits are tested
- [ ] Headers, rate limiting, and API validation are confirmed
- [ ] Verification and password-reset endpoints have provider-backed delivery and abuse monitoring
- [ ] Private-document uploads are restricted to approved operational roles and stored outside the public web root

## Commerce
- [ ] Restaurant and rider application approval workflow is tested
- [ ] Order state transitions are validated
- [ ] Payment provider initialization and verification are tested
- [ ] Payment webhooks reconcile provider reference, amount, and currency before fulfillment
- [ ] Order and delivery transitions are conditional and reject concurrent stale updates
- [ ] Delivery fee and commission configuration are reviewed
- [ ] Refund architecture is documented and approved

## UX and operations
- [ ] Public storefront routes work on mobile and desktop
- [ ] Customer order tracking works with real API responses
- [ ] Public tracking lookup has abuse limits and operational tracking access is ownership-checked
- [ ] Restaurant and rider portals are connected to live API data
- [ ] Support and notification flows are verified
- [ ] Audit logs capture admin-sensitive actions

## Release
- [ ] Production domain and HTTPS are configured
- [ ] Monitoring and alerts are enabled
- [ ] Database backup and restore testing is complete
- [ ] Manual QA signoff is captured for customer, restaurant, rider, and admin flows
