# DOORSTEP Notifications

## Current channels

- In-app notifications are persisted in PostgreSQL.
- Read-one and read-all operations are available.
- Order, payment, delivery, support, account, and security events can create notifications.
- Email verification uses a Resend API adapter, and SMS verification uses a Twilio API adapter when the corresponding credentials are configured. Provider delivery has not been verified in this audit.

## Provider-ready architecture

Transactional email/SMS notifications beyond verification and push delivery are not implemented as a unified notification service. Checkout and webhook requests should not wait on slow external delivery; use a queue or outbox worker when providers are enabled.

## Required production work

- Verify Resend and Twilio credentials in staging; implement Firebase-style push only if the product requires it.
- Add transactional email/SMS adapters for order and support events.
- Add delivery status, retry, dead-letter, and provider-rate handling.
- Add customer notification preferences and quiet hours.
- Avoid including private addresses, payment details, or full rider data in messages.
