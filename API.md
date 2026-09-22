# DOORSTEP API Reference

## Public endpoints

- `GET /api/health` — API health status
- `GET /api/health/database` — database-only health status
- `GET /api/ready` — database-aware readiness status for load balancers and deployment checks
- `GET /api` — API metadata
- `GET /api/payments/config` — provider configuration status
- `GET /api/service-areas` — currently enabled public operating areas
- `GET /api/restaurants?search=...&limit=24` — approved restaurant discovery with server-derived open status

## Authentication

- `POST /api/auth/verification/request`
- `POST /api/auth/verification/verify`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `PATCH /api/auth/me`
- `POST /api/auth/logout`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`

## Partner onboarding

- `POST /api/partner-applications`
- `POST /api/partner-applications/multipart` — validated restaurant application with private documents
- `POST /api/rider-applications`
- `POST /api/rider-applications/multipart` — validated rider application with private documents
- `GET /api/admin/applications/:type`
- `GET /api/admin/summary` — authenticated operational counts and today’s aggregate sales
- `GET /api/admin/orders?limit=50&cursor=...&status=...` — protected paginated order operations
- `GET /api/admin/finance-summary` — protected aggregate payment, commission, payout, and refund totals
- `GET /api/admin/audit-logs?limit=50&cursor=...` — protected paginated audit history
- `GET /api/admin/customers?limit=50&cursor=...&status=...` — protected customer management list
- `PATCH /api/admin/customers/:customerId/status` — audited customer status control
- `GET /api/admin/reviews?limit=50&cursor=...&pending=true` — review moderation queue
- `PATCH /api/admin/reviews/:reviewId/moderation` — approve or reject a review with an audit entry
- `GET /api/admin/settings` — editable marketplace settings
- `PATCH /api/admin/settings` — audited allow-listed marketplace setting update
- `POST /api/admin/applications/:type/:applicationId/review`
- `PATCH /api/admin/service-areas/:serviceAreaId` — enable or disable an operating area

## Customer commerce

- `POST /api/orders/validate` — server quote validates service area, restaurant availability, menu, and opening hours
- `POST /api/orders` — accepts an `Idempotency-Key` header to prevent duplicate orders during retries
- `GET /api/orders?limit=50&cursor=...` — cursor-paginated customer order history
- `GET /api/addresses`
- `POST /api/addresses`
- `PATCH /api/addresses/:addressId`
- `DELETE /api/addresses/:addressId`
- `GET /api/favorites`
- `POST /api/favorites`
- `DELETE /api/favorites`
- `GET /api/notifications`
- `PATCH /api/notifications/:notificationId/read`
- `POST /api/notifications/read-all`

## Support

- `POST /api/support/tickets`
- `POST /api/support/ai`
- `GET /api/support/tickets`
- `POST /api/support/tickets/:ticketId/messages`

## Reviews

- `GET /api/restaurants/:restaurantId/reviews?limit=6` — public approved-restaurant rating summary and recent review text
- `POST /api/reviews` — create one customer review for a delivered order

Restaurant order queues use the same `limit`/`cursor` pagination contract on `GET /api/restaurant/orders`.

## Payments and delivery

- `POST /api/payments/initialize`
- `POST /api/payments/webhook`
- The configured `PAYMENT_CALLBACK_URL` resolves to the frontend payment callback route, which waits for server-side verification rather than trusting query parameters.
- `POST /api/deliveries/:deliveryId/claim`
- `POST /api/deliveries/:deliveryId/status`
- `POST /api/deliveries/:deliveryId/location`

## Security expectations

- All sensitive endpoints require valid authentication
- Admin-only routes must enforce role validation
- Payment actions must be verified on the server
- Webhooks must validate provider signatures
- Input validation is required for user data and IDs

## Notes

The API is already ahead of a basic prototype, but production use still requires a reviewed migration, stronger deployment controls, and a full admin and operational security pass.
