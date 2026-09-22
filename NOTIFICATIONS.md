# DOORSTEP Notifications

## Current channels

- In-app notifications are persisted in PostgreSQL.
- Read-one and read-all operations are available.
- Order, payment, delivery, support, account, and security events can create notifications.

## Provider-ready architecture

Email, SMS, and push delivery should be implemented as adapters behind a notification service. Checkout and webhook requests should not wait on slow external delivery; use a queue or outbox worker when providers are enabled.

## Required production work

- Configure SMTP/email, SMS, and Firebase-style push credentials.
- Add delivery status, retry, dead-letter, and provider-rate handling.
- Add customer notification preferences and quiet hours.
- Avoid including private addresses, payment details, or full rider data in messages.
