# DOORSTEP iOS App Plan

The backend/API is designed to be shared by a future iOS client.

## Proposed client

- Bundle ID: choose a business-owned identifier later
- API base URL: environment-configured staging and production origins
- Auth: reuse the documented API contract with secure platform storage
- Payments: use the provider-approved hosted or tokenized flow
- Maps: use the selected provider SDK and least-privilege keys
- Push: APNs/Firebase configuration belongs in secure build settings

## Delivery plan

1. Version and test API contracts.
2. Build customer and rider flows against staging.
3. Add secure token storage, push notifications, network retry, and crash reporting.
4. Prepare TestFlight metadata and review evidence.
5. Release gradually after privacy and payment review.

No iOS project or App Store submission is created in this phase.
