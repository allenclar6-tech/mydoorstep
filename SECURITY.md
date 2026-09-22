# DOORSTEP Security Guide

## Implemented foundation

- Helmet security headers and CORS allow-listing
- Global and route-specific rate limits
- Zod request validation
- Scrypt password hashes and revocable opaque sessions
- Role and ownership checks for customer, restaurant, rider, and admin APIs
- HMAC Paystack webhook verification and payment reconciliation
- Private upload signature, size, and MIME validation
- Atomic delivery claims and conditional order/delivery transitions
- Audit entries for administrative application reviews

## Required before production

- Store secrets in a managed secret store and rotate local development credentials
- Add structured logging, alerting, dependency scanning, and security review
- Replace local private uploads with private object storage and malware scanning
- Add CSRF strategy if browser authentication moves to cookies
- Add lifecycle tests for password reset, payment replay, authorization, and uploads
- Review data retention for addresses, rider locations, documents, and support attachments
- Resolve the current Prisma transitive `deepmerge-ts@7.1.5` audit finding through a tested Prisma upgrade; do not use `npm audit fix --force` without reviewing the resulting Prisma version change

Never expose `PAYSTACK_SECRET_KEY`, database credentials, raw payment data, or private document URLs to the frontend.
