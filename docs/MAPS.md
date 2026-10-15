# DOORSTEP Maps and Location

## Initial operating area

DOORSTEP currently operates only in Sapele City, Delta State, Nigeria. Country, state, city, delivery-zone, latitude, and longitude fields are modeled for future expansion without activating other cities.

## Active map services

- The storefront map and delivery tracking use Mapbox GL JS for map tiles, geocoding, and driving-route previews.
- Google Places autocomplete and place details are provided by the API using the server-side `GOOGLE_MAPS_API_KEY`. If Google Places is unavailable, Mapbox search remains available.
- Configure the public Mapbox token as `VITE_MAP_PUBLIC_TOKEN` at frontend build time. The older `VITE_MAPBOX_ACCESS_TOKEN` name remains supported for existing local builds. This token is embedded in the public frontend; restrict it to the production website origins and only the required Mapbox APIs. Never use a secret-scope token in a `VITE_*` variable.
- On `mydoorstep.com.co`, Google Places requests use the same-origin `/api` proxy. Local development and other preview hosts use `VITE_API_BASE_URL`.
- If the Mapbox token is absent, the map and Mapbox geocoding are unavailable, but Google Places search can still select a delivery point and the user can confirm its coordinates. Device location and manual map pinning require a working interactive map.
- Production verification on 2026-10-15 confirmed that the `/location` map loads, Amukpe search combines Mapbox and Google Places results, selecting a result produces a driving-route/ETA preview, and Google place details return coordinates.
- The location picker uses a north-up, top-down map for reliable pin placement. Its explicit current-location action uses the browser's permission-controlled geolocation once, reports GPS accuracy, and keeps manual search/pinning available.

## Privacy rules

- Capture rider locations only during active assigned deliveries.
- Expose the latest location only to the owning customer, assigned rider, restaurant owner for that order, or authorized admin.
- Define retention and deletion windows before launch.
- Do not expose customer addresses through public discovery or SEO pages.

Driving route previews and ETA estimates are available through Mapbox, currently from central Sapele as a preview only. They are not store-to-customer delivery quotes. Distance-based delivery fees remain pending a reviewed service-area policy; do not infer fees from a route preview.

The location picker shows the chosen coordinates to seven decimal places, preserves the reported GPS accuracy separately from coordinate precision, and restores the last confirmed point. Saved-address and checkout flows now submit confirmed coordinates; order creation persists them with the address and order snapshot so delivery tracking can place the destination marker precisely. These changes are in the worktree and require deployment/production verification. See [MAP_LOCATION_AUDIT.md](./MAP_LOCATION_AUDIT.md) and [MAP_LOCATION_PROGRESS.md](./MAP_LOCATION_PROGRESS.md) before enabling distance pricing or representing a map point as service-area verified.
