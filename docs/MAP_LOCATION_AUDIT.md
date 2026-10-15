# Map and Location Flow Audit

Audit date: 2026-10-15

## Existing components and providers

- `src/LocationMap.jsx` renders the customer location picker with Mapbox GL JS, Mapbox forward/reverse geocoding and driving directions. Google Places autocomplete and place details are accessed through the API.
- `src/DeliveryTrackingMap.jsx` renders customer delivery tracking with destination/rider markers and a Mapbox route preview.
- `server/index.js` exposes rate-limited Google Places autocomplete and place-detail endpoints. The Google API key stays server-side.
- Rider location updates and reads are implemented in `server/deliveryService.js`, `server/realtime.js`, and authenticated delivery routes in `server/index.js`.
- The configured operating area is Sapele, Delta State. `ServiceArea` describes enabled cities; `DeliveryZone` is a separate model.

## Current customer location flow

1. `/location` opens the Mapbox picker centred on Sapele.
2. The customer searches through Mapbox and Google Places, chooses a result, taps the map, or uses browser geolocation.
3. A draggable pin identifies the delivery point. Reverse geocoding may refine its display label.
4. Explicit confirmation writes the label, coordinates, selection source, and available GPS accuracy to browser `localStorage`. The picker displays the selected latitude/longitude to seven decimal places and restores the point when reopened.
5. Selecting a named Sapele area changes the label and clears any previously stored exact coordinates.

The saved-address form now links to the map picker and submits the confirmed coordinates to the authenticated address API. Checkout links to the same picker, submits the pin coordinates with order creation, and the API persists those coordinates on both its checkout address and order destination snapshot. The existing delivery-tracking map already reads order destination coordinates. These code changes are implemented locally and still require deployment and production verification.

## Routing and coverage limits

- Location-picker route previews originate at central Sapele, not at the selected restaurant. They are useful for map orientation only and must not be presented as a store-specific delivery quote.
- The delivery-tracking map uses stored order destination coordinates for the customer marker. Restaurant position may still come from its text address.
- The current enabled service-area model is city-based, not a polygon containment check. Selecting or confirming a map point does not establish that a particular store serves it.
- No verified distance-based pricing rule or map-admin service-boundary editor was found in the current flow.

## Privacy and safety observations

- Browser geolocation is requested only after the customer explicitly activates the location control. Permission denial and GPS accuracy are surfaced.
- Rider location APIs require authenticated, authorized delivery context. Preserve these checks and the active-delivery restriction when extending tracking.
- Public Mapbox tokens are exposed by the client by design; restrict tokens to the production origins and required APIs. Keep Google credentials on the API host.
- Do not expose exact customer coordinates in public discovery or use route previews as proof of delivery eligibility.

## Release boundary

The pin-to-address and pin-to-order integrations are implemented in the current worktree but are not yet deployed. Store-specific coverage validation, operational distance pricing, and admin map tools require separate backend behavior and policy decisions and are not claimed as complete.
