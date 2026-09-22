# DOORSTEP Android App Plan

The backend remains the source of truth and is reusable by Android clients.

## Proposed client

- Application ID: choose a business-owned reverse-domain identifier later
- API base URL: environment-configured staging and production origins
- Auth: use the existing session/API contract; never embed server secrets
- Payments: use provider-approved mobile checkout or hosted flow
- Maps: use the selected provider SDK with least-privilege keys
- Push: Firebase configuration supplied through secure build environments

## Delivery plan

1. Stabilize and version API contracts.
2. Add mobile-specific auth/session handling and push token registration.
3. Implement customer and rider flows against staging.
4. Add crash reporting, offline retry behavior, and signed release builds.
5. Complete Play Console review and staged rollout.

No Android project or store submission is created in this phase.
