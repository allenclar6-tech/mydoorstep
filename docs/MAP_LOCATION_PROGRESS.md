# Map and Location Implementation Progress

Updated: 2026-10-15

## Completed

- Published a responsive delivery-location picker with a spacious desktop workspace and a full-screen mobile map, compact search/GPS actions, map controls, a pin-placement hint, a selected-point summary, route preview, close action, and distinct confirmation.
- Kept Mapbox map rendering, search, reverse geocoding, and routing; added support for the documented `VITE_MAP_PUBLIC_TOKEN` name while retaining the legacy token variable.
- Kept Google Places as a server-side search/details fallback and aligned production API calls to the same-origin `/api` proxy.
- Corrected the Mapbox geocoding feature-type request and removed the unnecessary pitched/3D map perspective so the map is easier to orient and place a pin on.
- Avoided making a second browser geolocation request when the map control can provide the authorized device position. GPS accuracy and permission errors are shown; manual selection remains available.
- Saved the confirmed coordinates with the current browser delivery-location selection and clear stale coordinates when the customer chooses an area-only location.
- Shows seven-decimal latitude/longitude for the selected pin and distinguishes reported GPS uncertainty from a manually placed pin or a geocoding result. Reopening the picker restores the last confirmed coordinates; map clicks zoom in for entrance-level pin placement.
- Added a route from saved-address creation and checkout into the map picker. Confirmed coordinates are submitted with saved addresses and order creation, stored on the address and order destination, and consumed by the existing delivery-tracking map.
- Rejects partial latitude/longitude pairs on saved-address and order APIs. Changing the checkout address clears the selected map point so coordinates cannot silently refer to a different typed address.
- Verified production Mapbox search, Google Places coordinates, map loading, route preview, desktop/mobile/narrow viewport overflow, frontend build, and the 33 API tests.

## Remaining

1. Deploy the pending frontend and API changes, then verify exact coordinates survive saved-address creation and order creation in production.
2. Define authoritative service-area/store-coverage rules and validate the order destination server-side before checkout.
3. Replace the fixed delivery fee only after DOORSTEP approves a pricing policy and a store-to-customer routing/quote source.
4. Verify rider location publishing and customer live tracking end-to-end with an authorized test order; do not use fabricated positions.
5. Add map-based admin operations only with role checks, auditable changes, and approved service boundaries.

Coverage validation, distance-based pricing, and admin boundary tools remain intentionally out of scope. The coordinate-to-order changes are implemented in the worktree but are not yet live.
