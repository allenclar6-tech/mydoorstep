# Package delivery, map upgrade and rider workflow

Added 2026-10-19. This document is the completion report for this upgrade. It lists what was built, what was actually tested, and what still has to be configured and checked by you.

## What was built

**Customer: send a package** (`/send`, `/parcels`, `/parcels/:id`)
- A three-step booking flow: Route, then Details, then Review & pay. The draft is kept in session storage, so the selected pins survive moving between steps and screens.
- The route picker has independent pickup (A) and destination (B) pins. You can search (Mapbox addresses and streets, Mapbox Search Box for businesses and landmarks, and the existing server-side Google Places fallback), use GPS, tap the map, drag pins, use saved addresses (Home, Work, …) from `/api/addresses`, clear a pin, and see the coordinates. The point's source is shown: GPS accuracy (position uncertainty) is shown separately from road distance and drive time.
- Road route preview with alternative routes. You can tap a route option or an alternative line to select it.
- Review shows prices calculated by the server for each road route: base fare, distance fee, minimum-fare adjustment, service fee and total. The ETA is labelled as an estimate.
- Payment by Paystack, or by bank transfer when admin has enabled it. A test-mode badge is shown when the server key is `sk_test_`.
- Booking detail page:
  - status timeline and event history
  - pay or retry payment, and bank transfer instructions with copy buttons
  - list of available riders, with real arrival estimates where the rider shares a location, and the option to request a specific rider (2-minute window)
  - live tracking map, a call-rider link while the delivery is active, edit before payment, cancel before pickup, and rating the rider after delivery
- Payment callback (`/payment/callback`) now asks the server to verify with Paystack. It works for both food orders and parcels.

**Maps**
- Shared map core (`src/map/mapCore.js`). Route lines, GPS accuracy circles and similar overlays are registered with a controller and re-added after every `style.load`. Markers are DOM-based and survive style changes. Switching style keeps the centre, zoom, bearing and pitch, and never reloads the page.
- A Layers button (`src/map/LayersControl.jsx`) offers the 9 requested styles. It is a popover on desktop and a bottom sheet on phones. Before presenting the list, it probes each style against the Mapbox Styles API with the configured token. Styles the token or website restriction does not allow are greyed out, with the reason shown. If a style fails to load, the map falls back to the previous style. The chosen style is remembered per browser.
- Standard is the default style.
- The Layers button is on the delivery-point picker (`/location`), the package route picker, the live tracking map and the `/navigate` workspace.
- Mobile layout fixes:
  - Search results are no longer absolutely positioned over the map, so they can't be clipped.
  - Layers is top-left, zoom and compass are top-right, recenter is bottom-right above the attribution, and the scale is bottom-left.
  - The confirm button is a sticky footer, so it stays reachable while scrolling.
  - The page scrolls instead of being clipped at a fixed `100dvh - 124px`.
  - Safe-area padding has been added, and 16px inputs stop iOS from zooming.
  - The floating Chat button is hidden on full-screen map screens; a Help button in the map header opens chat instead. In the booking flow it is lifted above the sticky action bar.

**Riders**
- The dashboard's made-up numbers (7 deliveries, ₦9,800, 88%, 4.9★/84) are gone. It now shows real data from `/api/rider/summary`: deliveries today, active deliveries, payout-recorded earnings, all-time deliveries, and the rating (or "New").
- The online/offline toggle now loads the real current state. Approval is required before a rider can go online.
- Riders can opt in to sharing their location while online. The position is used only on the server to compute road arrival estimates for customers; customers never see the coordinates. It is cleared when the rider goes offline.
- Package jobs:
  - "Requested for you" with a countdown, plus Accept and Decline
  - open jobs with Accept
  - the active job shows contacts with call links, a "Navigate" link (opens Google Maps directions; no API key needed), stage buttons, and "hand back" before pickup
- A rider can't accept a second job while one is active. This now also applies to food orders.

**Server**
- `server/parcelService.js`:
  - pricing settings, validated and audited
  - road routing through Mapbox Directions. It never falls back to straight-line distance.
  - integer-kobo pricing and the service-area radius check
- `server/parcelRoutes.js`:
  - quote, create (with idempotency key), list, detail, edit, pay, cancel, available riders, request rider, rate
  - rider jobs, accept, decline, hand back, summary, and availability location
  - admin pricing and bookings
- The price is always recalculated on the server from a fresh road route when the booking is created. If it differs from what the customer saw, the booking is refused with `PRICE_CHANGED` and the new quote is returned.
- Paystack:
  - The server initialises the payment. `POST /api/payments/verify` checks with Paystack server-to-server, for orders and parcels.
  - The webhook now handles parcels too, and checks reference, amount and NGN currency.
  - Confirmation is idempotent (a conditional update), so webhook plus verify can't double-apply a payment.
  - Before handing out a checkout link again, the server checks the existing one with Paystack. A link that is still pending is reused instead of creating a second charge.
  - Failed attempts get a new reference. The old reference is kept, so a late webhook still reconciles. If an old attempt is also paid, it is flagged `DUPLICATE_PAYMENT_REFUND_REQUIRED`.
  - Paying for a cancelled booking is flagged `REFUND_REQUIRED` instead of reviving the booking.
- Lifecycle: Pending payment → Payment confirmed → Searching for rider → Rider assigned → Rider en route to pickup → Package picked up → In transit → Delivered, plus Cancelled. Every change is a `ParcelEvent` row. Transitions are only made by the server, using conditional updates.
- Live tracking:
  - Fixed a bug where WebSocket messages were ignored. The server sent `{type, location}` but the page read `message.data`, so customers only saw updates from the 15-second poll.
  - Status changes are now pushed, and the stream closes on delivery or cancellation.
  - The precise rider location is withheld once the delivery is no longer active.
  - The map shows when the rider's location is stale.
- Other bugs fixed:
  - `/categories/*` crashed because `categories` was never imported.
  - Saving a favourite from the home page referenced an undefined `restaurants`.
  - After login, customers now return to the page they came from (same-site paths only).
- Admin → Packages (`/admin/parcels`): set services and fares, service fee, service radius and maximum distance; list recent bookings. Bank transfer confirmation (`POST /api/admin/bank-transfers/:id/confirm`) now also works for parcels.

## Database migration

`prisma/migrations/20261019160000_add_parcel_bookings/migration.sql` makes these changes, all additive (existing food orders are untouched):
- Adds `ParcelStatus` enum, `ParcelBooking` and `ParcelEvent` tables.
- `Delivery.orderId` and `Payment.orderId` become nullable, and each gets a `parcelBookingId`. A CHECK constraint enforces that every row belongs to exactly one order or parcel.
- Adds `Delivery.requestedRiderId`, `requestExpiresAt` and `cancelledAt`.
- Adds the rider availability-location columns.

Apply it with your normal deploy step (`npm run db:migrate:deploy`, or `node server/migrate.js` on Render).

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `VITE_MAP_PUBLIC_TOKEN` | Frontend build (Cloudflare/Render web) | Public `pk.` token for maps, search, geocoding and route preview. Public by design: restrict it in Mapbox to your site URLs (below). |
| `MAPBOX_SERVER_TOKEN` | **API host only** (Render secret) | **New.** Used for Directions in pricing and rider ETA. Use a separate token **without** URL restrictions, because server requests carry no browser referrer. Never prefix it with `VITE_`. |
| `PAYSTACK_SECRET_KEY` | API host only | Existing. `sk_test_` locally; switch to `sk_live_` only when your Paystack account is approved. |
| `PAYMENT_CALLBACK_URL` | API host | Existing. Must be `https://mydoorstep.com.co/payment/callback`. |

Your local `.env.local` currently uses the older name `VITE_MAPBOX_ACCESS_TOKEN`. It still works, but `VITE_MAP_PUBLIC_TOKEN` is the documented name.

## Mapbox account steps (you must do these; they can't be done from code)

1. Open Mapbox, then Account, then Tokens, and edit the **public** token used for `VITE_MAP_PUBLIC_TOKEN`.
   - Under URL restrictions, add `https://mydoorstep.com.co`, `https://mydoorstep-web.onrender.com`, `https://mydoorstep-site-20260922.eyedofejiro10.workers.dev`, and `http://localhost:5173` for development.
   - Keep only the public scopes: `styles:read`, `styles:tiles`, `fonts:read`, `datasets:read` and `vision:read` are the defaults. Do not add secret scopes.
2. Create a **second** token for the server. Public scopes are enough. Add no URL restriction. Put it in Render as `MAPBOX_SERVER_TOKEN`.
3. After deploying, open the site and press the Layers button. Any style your account or token can't load is shown as "Unavailable", with the reason.

## Paystack steps

1. In the Paystack dashboard, set the webhook URL to `https://mydoorstep-api.onrender.com/api/payments/webhook`. If you route the API through the Cloudflare `/api` proxy, use `https://mydoorstep.com.co/api/payments/webhook` instead.
2. Card and bank channels are whatever your Paystack account has enabled. DOORSTEP doesn't force channels.
3. Refunds are **not** automatic. Look for `REFUND_REQUIRED` and `DUPLICATE_PAYMENT_REFUND_REQUIRED` transactions, and admin notifications.
4. Parcel rider payouts aren't calculated yet, because the rider share is a business rule you haven't defined. Rider earnings show payout-recorded amounts only.

## Turning package delivery on

1. Deploy the API with `MAPBOX_SERVER_TOKEN`, and run the migration.
2. Go to Admin, then Packages. Add at least one service with your **approved** fares, set the service radius (for example 15 km around Sapele), tick "Accept package bookings", and save.
3. Until then, `/send` explains that fares aren't published and does not take bookings.

## Testing: what was and wasn't verified

The environment I worked in could not install npm packages or reach Mapbox or Paystack. Your computer link only allowed file copying, not running commands. So:

**Verified**
- A static check of all 69 JS/JSX files, using the TypeScript parser in checkJs mode, for syntax errors and undefined names: 0 issues. It also found the two existing crash bugs listed above, which are now fixed.
- `node --check` on every server and test file.
- A layout check in headless Chromium with the real stylesheets, on static mock-ups of the new screens (not the live React app). Viewports: 320×568, 360×740, 390×844, 768×1024, 844×390 landscape and 1280×800. Results:
  - No horizontal overflow.
  - The confirm button stays on screen while scrolling, in every case.
  - No overlap between the Layers button, zoom, recenter and scale controls.
  - The Chat button doesn't cover the confirm button.
  - The Layers bottom sheet sits above the sticky footer.

**Not yet run**
- `npm test`, including the new `tests/parcel.test.js`: pricing maths, routing errors, validation, privacy of serialized bookings, idempotent payment confirmation, and a scan for secrets in frontend code.
- `npm run build`, and inspecting the built bundle for secrets.
- `npm run test:integration` with `DOORSTEP_INTEGRATION_DATABASE_URL` pointing at a migrated dev database. This is the full flow: book, pay (stubbed), verify, webhook duplicates, rider request and accept, stages, tracking, access control, cancel with refund flag, and rating.
- **Mapbox:** none of the 9 styles was loaded with your token. No search, geocoding or routing was run against Mapbox. Console and network errors weren't inspected.
- **Paystack:** no real or test transaction was made.
- Real phones and GPS.

### Commands to run on your computer

```
npm install
npx prisma generate
npm test
npm run build
# then search the build output for secrets; this should print nothing:
grep -rE "sk_(live|test)_|MAPBOX_SERVER_TOKEN|DATABASE_URL" dist/ || echo "no secrets in bundle"
```

### Manual map style check (after deploying)
On a phone and on desktop, open `/send`, set both pins, select an alternative route, then:
1. Press Layers and pick each style in turn.
2. After each switch, confirm that both pins, the route line and its colour, the zoom and the position are unchanged.
3. Check the browser console and network tab for 401, 403 or 404 errors on `api.mapbox.com`.

Repeat on a live delivery in `/parcels/:id` to see the rider marker survive style changes.
