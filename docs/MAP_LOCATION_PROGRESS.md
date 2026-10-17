# Map and Location Implementation Progress

Updated: 2026-10-16

## Completed

- Deployed the separate Mapbox navigation workspace at `/navigate` as Worker
  version `1f71f6e6-dac3-4eb0-9abd-4bb298c6cbf4`. Live checks verified real
  driving alternatives, turn instructions, walking/cycling routes and mobile
  layouts at 320px and 390px. The release excluded unrelated onboarding changes
  and required no API or database deployment. No paid Google service was enabled.

- Published a responsive delivery-location picker with a spacious desktop workspace and a full-screen mobile map, compact search/GPS actions, map controls, a pin-placement hint, a selected-point summary, route preview, close action, and distinct confirmation.
- Kept Mapbox map rendering, search, reverse geocoding, and routing; added support for the documented `VITE_MAP_PUBLIC_TOKEN` name while retaining the legacy token variable.
- Kept Google Places as a server-side search/details fallback and aligned production API calls to the same-origin `/api` proxy.
- Corrected the Mapbox geocoding feature-type request and removed the unnecessary pitched/3D map perspective so the map is easier to orient and place a pin on.
- Avoided making a second browser geolocation request when the map control can provide the authorized device position. GPS accuracy and permission errors are shown; manual selection remains available.
- Saved the confirmed coordinates with the current browser delivery-location selection and clear stale coordinates when the customer chooses an area-only location.
- Shows seven-decimal latitude/longitude for the selected pin and distinguishes reported GPS uncertainty from a manually placed pin or a geocoding result. Reopening the picker restores the last confirmed coordinates; map clicks zoom in for entrance-level pin placement.
- Added a route from saved-address creation and checkout into the map picker. Confirmed coordinates are submitted with saved addresses and order creation, stored on the address and order destination, and consumed by the existing delivery-tracking map.
- Rejects partial latitude/longitude pairs on saved-address and order APIs. Changing the checkout address clears the selected map point so coordinates cannot silently refer to a different typed address.
- Deployed the coordinate flow and narrow-screen layout to the production Cloudflare Worker. Production verification confirmed the `/location` map loads, Sapele search selects a point and displays its coordinates, the map canvas resizes with the layout, and the 320×740 viewport has no page overflow. The deployed Worker was also checked at 390×844.
- Rebuilt the frontend and passed all 34 API tests. Production `/api/ready` reports the database ready.
- Redeployed the production Cloudflare Worker as version `bab1b291-e027-452f-b64e-bc974573c4b4` from commit `824683e`. The live map rendered, a Mapbox Sapele result selected a point with coordinates and a route preview, and the production API reported ready with the Sapele service area enabled.
- One Google Places suggestion did not resolve coordinates during the live smoke test; the picker displayed its fallback guidance, and Mapbox results and manual pin placement remained available. No production address or order was created.

## Remaining

The separate navigation workspace at `/navigate` uses the existing Mapbox provider
by owner approval. The Google adapter remains optional and disabled pending billing
and restricted keys. It does not replace the delivery-pin workflow. Real-device
GPS guidance still needs validation. See
[NAVIGATION.md](./NAVIGATION.md).

1. Verify saved-address creation and order destination persistence with an authorized production account/test order; no production customer records were created during this release check.
2. Define authoritative service-area/store-coverage rules and validate the order destination server-side before checkout.
3. Replace the fixed delivery fee only after DOORSTEP approves a pricing policy and a store-to-customer routing/quote source.
4. Verify rider location publishing and customer live tracking end-to-end with an authorized test order; do not use fabricated positions.
5. Add map-based admin operations only with role checks, auditable changes, and approved service boundaries.

Service-coverage validation, distance-based pricing, and admin boundary tools remain intentionally out of scope. Real-device GPS accuracy also remains unverified; coordinate decimal precision is not a guarantee of physical location accuracy.
