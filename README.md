# DOORSTEP

DOORSTEP is a production-oriented food delivery marketplace for Sapele, Delta State, Nigeria. The repository combines a Vite + React storefront with an Express + Prisma backend so the project can serve as a live marketplace MVP while staying ready for future mobile clients.

## Project overview

- Customer discovery, restaurant browsing, cart, checkout, payments, order tracking, and support
- Restaurant partner onboarding and approval workflow
- Rider onboarding, availability, and delivery workflow
- Admin dashboard for approvals, operations, finance, and audits
- PostgreSQL + Prisma data model used for orders, users, restaurants, riders, payments, and audit trails

## Architecture summary

- Frontend: Vite + React
- Backend: Node.js + Express
- Database: PostgreSQL with Prisma ORM
- Auth: scrypt password hashing and opaque session tokens
- Payments: Paystack-first provider adapter with server-side verification
- Storage: private upload adapter with validation and storage-key based references
- Domain: role-based access across customer, restaurant, rider, and admin flows

## Project docs

The project includes the required documentation set:

- [docs/PROJECT_AUDIT.md](docs/PROJECT_AUDIT.md)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/DATABASE.md](docs/DATABASE.md)
- [docs/API.md](docs/API.md)
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- [docs/LAUNCH_CHECKLIST.md](docs/LAUNCH_CHECKLIST.md)
- [docs/BUILD_PROGRESS.md](docs/BUILD_PROGRESS.md)
- [docs/SECURITY.md](docs/SECURITY.md)
- [docs/PAYMENTS.md](docs/PAYMENTS.md)
- [docs/MAPS.md](docs/MAPS.md)
- [docs/NOTIFICATIONS.md](docs/NOTIFICATIONS.md)
- [docs/DOMAIN_SETUP.md](docs/DOMAIN_SETUP.md)
- [docs/LOAD_TESTING.md](docs/LOAD_TESTING.md)
- [docs/DISASTER_RECOVERY.md](docs/DISASTER_RECOVERY.md)
- [docs/ANDROID_APP_PLAN.md](docs/ANDROID_APP_PLAN.md)
- [docs/IOS_APP_PLAN.md](docs/IOS_APP_PLAN.md)
- [docs/GOOGLE_PLAY_CHECKLIST.md](docs/GOOGLE_PLAY_CHECKLIST.md)
- [docs/APPLE_APP_STORE_CHECKLIST.md](docs/APPLE_APP_STORE_CHECKLIST.md)

## Current implementation status

### Working foundation

- Customer auth flow with session handling
- Restaurant and rider application APIs
- Payment initialization and webhook verification patterns
- Delivery claim and status transitions
- In-app notifications and support ticket flow
- Admin review endpoints for restaurant and rider applications
- Search, discovery, cart, checkout, and customer portal pages

### Production gaps that remain

- Managed PostgreSQL deployment and migrations
- Real operating secrets in environment management
- Production object storage for private uploads
- Full email/SMS/push notification providers
- Live admin and finance operations UI connected to all APIs
- Final legal copy and owner-specific business setup

## Installation

Use the local Windows-safe path in this workspace:

```bash
npm.cmd install
```

If PowerShell blocks `npm.ps1`, use `npm.cmd` throughout the repository instead of `npm`.

## Environment configuration

Create a `.env` file from [.env.example](.env.example). Required production variables include:

```bash
DATABASE_URL=postgresql://doorstep_user:change_me@localhost:5432/doorstep
API_PORT=4000
WEB_ORIGIN=http://localhost:5173
NODE_ENV=development
AUTH_SECRET=replace_with_secure_random_secret
PAYMENT_PROVIDER=paystack
PAYSTACK_PUBLIC_KEY=
PAYSTACK_SECRET_KEY=
FLUTTERWAVE_PUBLIC_KEY=
FLUTTERWAVE_SECRET_KEY=
GOOGLE_MAPS_API_KEY=
MAPBOX_TOKEN=
CLOUDINARY_URL=
FIREBASE_CONFIGURATION=
EMAIL_PROVIDER=
SMS_PROVIDER=
NEXT_PUBLIC_APP_URL=http://localhost:5173
PRIVATE_UPLOAD_DIR=./private-uploads
```

Keep all secrets server-side. Never expose private provider keys in the frontend bundle.

## Domain deployment

The purchased domain plan is documented for `mydoorstep.com.co`:

- Website: `https://mydoorstep.com.co`
- Admin: `https://mydoorstep.com.co/admin/login`
- API: `https://api.mydoorstep.com.co`

See [docs/DOMAIN_SETUP.md](docs/DOMAIN_SETUP.md), [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), and [.env.cloudflare.example](.env.cloudflare.example).

## Database setup

1. Create a PostgreSQL database.
2. Fill in `DATABASE_URL` in `.env`.
3. Run Prisma generation:

```bash
npm.cmd run db:generate
```

4. For local schema sync:

```bash
npm.cmd run db:push
```

5. Seed development data:

```bash
npm.cmd run db:seed
```

## Running locally

Start the API:

```bash
npm.cmd run api
```

Start the frontend:

```bash
npm.cmd run dev
```

## Testing

The project’s automated API tests are run with Node’s built-in test runner:

```bash
node --test tests/api.test.js
```

This is the reliable command in this workspace because PowerShell can block `npm test` on some machines.

## Building

```bash
npx vite build
```

## Deployment

Use a managed PostgreSQL provider, a managed Node runtime for the API, and a production secret manager. The deployment guide covers the recommended production architecture in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Payment setup

- Main provider: Paystack
- Provider adapter: configured via `PAYMENT_PROVIDER`
- Secret keys must remain on the server only
- Callback URL should be set in the deployment environment
- Webhooks must be validated with the provider signature before order/payment changes are applied

## Maps setup

- `GOOGLE_MAPS_API_KEY` or `MAPBOX_TOKEN` should be provided through environment variables.
- Avoid embedding secret map credentials in frontend code.
- Use them for delivery area logic, ETA support, and map-based operational features.

## Notifications setup

The app is structured for:

- Email notifications
- SMS notifications
- Push notifications using Firebase-style configuration
- In-app notifications stored in the database

Production setup requires passing credential configuration through `.env` and a notification service adapter.

## Legal and public pages

The app includes placeholder legal pages for production use:

- `/privacy`
- `/terms`
- `/refund-policy`
- `/cancellation-policy`
- `/restaurant-partner-terms`
- `/rider-terms`
- `/delivery-policy`
- `/contact`

These pages are intentionally clear placeholders for the business owner to finalize before commercial launch.

## Security and production note

This repository is functionally farther along than a static demo, but it still needs a real business deployment setup, higher-level operational logging, and provider-backed integrations before being treated as a production marketplace. The app already includes a working backend foundation, but finance, payment verification, monitoring, and operational controls still require owner-controlled credentials and a production runbook.
