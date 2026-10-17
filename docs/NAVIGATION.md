# DOORSTEP Interactive Navigation

## Active release: existing Mapbox service

Deployed at `https://mydoorstep.com.co/navigate` as Cloudflare Worker version
`1f71f6e6-dac3-4eb0-9abd-4bb298c6cbf4`. Production browser checks verified map
rendering, two driving alternatives, alternative selection, road-name turn
instructions, walking/cycling responses, and mobile layouts at 320px and 390px
without horizontal overflow. Real-device GPS guidance is not claimed as verified.

Navigation defaults to **Mapbox**, as approved by the owner after Google Cloud
required billing setup. No Google billing account, paid service or new Google key
is required for this release. Mapbox usage remains subject to the existing
account's quotas and pricing; this is not unlimited free navigation.

The Mapbox adapter uses the existing `VITE_MAP_PUBLIC_TOKEN` (or legacy
`VITE_MAPBOX_ACCESS_TOKEN`) for Maps, Search Box suggest/retrieve, and Directions.
Search covers places and businesses where supported. Driving, walking and cycling
use real polylines and turn instructions. Driving avoidance maps to `toll`,
`motorway` and `ferry` exclusions. Estimates use the standard driving profile, not
continuous live traffic prediction.

Set `VITE_NAVIGATION_PROVIDER=mapbox` (the default), build, and deploy the frontend
Worker. No API change or database migration is needed. Calls go directly to Mapbox
with the public browser token. The existing delivery picker and API are unchanged.
Keep token URL restrictions enabled; localhost may be rejected when it is not an
approved origin.

From the production origin, the existing token returned Sapele Search Box
suggestions and two real driving routes. Full-page and real-device GPS checks are
separate validation steps. Provider quotas still apply.

GPS tracking, stop editing, sharing, saved destinations and responsive controls are
shared by both adapters. The Google sections below document only the **optional
future integration**. Do not select `VITE_NAVIGATION_PROVIDER=google` without first
configuring and reviewing its billing, API and key requirements.

## Entry points and release boundary

`/navigate` is a dedicated, lazy-loaded React navigation workspace. Open it using the
navigation-arrow link next to the delivery-location search/GPS controls on
`/location`. The existing Mapbox delivery-pin picker, saved addresses, checkout,
customer order tracking, and rider delivery permissions remain unchanged.

The optional Google adapter is a real integration, not a simulated route.
It requires Google Cloud configuration before it can function.
The implementation does not enable Google APIs, billing, key restrictions, or
Render secrets automatically. It has not been published over the existing
production map.

## Optional Google Cloud setup

Use a Google Cloud project with billing enabled and approved Google Maps Platform
terms. Enable:

- Maps JavaScript API for the browser map.
- Places API (New) for server-side autocomplete and place details.
- Routes API for server-side `computeRoutes`.

Create **two separate keys**:

1. **Browser key**: restrict its API access to Maps JavaScript API and its application
   access to HTTP referrers. Allow only your actual origins, such as
   `https://mydoorstep.com.co/*` and your specifically approved preview hosts.
   Use a separate development browser key restricted to
   `http://localhost:5173/*` or the local port you use. Browser keys are public by
   design; they are embedded in the frontend.
2. **Server key**: restrict its API access to Routes API and Places API (New).
   Restrict its application access to the API service's outbound IP addresses
   where supported by your hosting plan. Store it in the API host's secret manager.
   Never put this key in a `VITE_*` variable, source file, URL, screenshot, or chat.

Create a JavaScript **vector map ID** in Google Cloud for production. The component
uses Google's `DEMO_MAP_ID` only when no map ID has been provided for development.
Configure billing budgets, quota alerts, and appropriate API quotas; public
navigation requests consume your Google quota.

## Environment

See [../.env.example](../.env.example) and
[../.env.cloudflare.example](../.env.cloudflare.example).

API host:

```dotenv
GOOGLE_NAVIGATION_API_KEY=
```

Frontend, at **build time**:

```dotenv
VITE_GOOGLE_MAPS_API_KEY=
VITE_GOOGLE_MAP_ID=
VITE_API_BASE_URL=http://localhost:4000
```

The existing `GOOGLE_MAPS_API_KEY` remains dedicated to the old delivery picker's
Places fallback. It is not automatically reused for navigation, so its existing
restrictions and behavior are not changed.

When Google is selected, navigation on `mydoorstep.com.co` uses same-origin `/api/navigation/*`, proxied by
the existing Cloudflare Worker. Other hosts use `VITE_API_BASE_URL`. Add approved
development/preview origins to the API's `WEB_ORIGIN`/`WEB_ORIGINS` when needed.
HTTP loopback hosts are suitable for development; production GPS requires HTTPS.

Run locally in separate terminals:

```powershell
npm.cmd run api
npm.cmd run dev
```

Open `http://localhost:5173/navigate`.

## Functionality

- Mapbox streets (or the optional Google vector map) with real roads, POIs, pan,
  zoom and rotation; the active provider's attribution stays visible.
- Start and destination autocomplete for addresses, businesses, and landmarks.
  Searches are biased towards Sapele but not restricted to delivery coverage.
  Search results use session tokens and resolve coordinates through Mapbox Search
  Box retrieval (Google Places details for the optional adapter).
- Explicit manual map selection for each waypoint, a blue GPS dot and accuracy
  circle, red destination pin, and numbered intermediate stops.
- Driving, walking and cycling routes where available. Mapbox uses standard
  driving estimates; only the optional Google adapter requests traffic-aware
  routing. Toll, highway and ferry avoidance preferences apply to driving only.
- Up to eight intermediate stops plus one final destination. Accessible up/down
  buttons reorder stops; the final list entry is the destination.
- Up to three provider-returned routes, each selectable on the map or in the panel.
  Alternatives are requested only without intermediate stops.
- Route overview automatically fits the full selected route. Distance, duration,
  arrival estimate, provider warnings, and plain-text turn instructions remain
  synchronized with the selected route.
- Explicit **Start** activates real `watchPosition` tracking. Stop, close, route edits,
  navigation errors requiring a stop, and page unmount clear the GPS watch.
- Navigation displays the upcoming instruction, estimated distance to its turn,
  remaining route distance and time, and available device heading. Overview and
  follow controls let the user explore or recenter.
- Two consecutive accurate off-route fixes trigger rerouting, with a minimum
  20-second interval. Rerouting keeps unvisited stops in order. GPS accuracy above
  100 metres pauses automatic rerouting; a stale GPS signal is flagged after
  20 seconds. Location permission denial stops tracking.
- Route links include the origin, stops, travel mode and preferences; sharing asks for confirmation
  because those coordinates become visible to anyone with the link. A recipient
  calculates a fresh route rather than receiving stale cached directions.
- Destinations can be saved and removed in this browser's local storage. They are
  not saved as customer delivery addresses or synced to an account. No navigation
  location stream is sent to the rider-delivery API.
- Missing keys, rejected provider requests, quotas, unsupported routes, network
  failures, denied GPS permissions and invalid links produce visible errors. The
  application never fabricates successful routes when the provider is unavailable.

Search is debounced for 400 ms and route edits for 450 ms. Superseded requests are
aborted and their results discarded. Optional Google calls have 12-second server
timeouts; browser API calls time out after 20 seconds. The Google API's separate limiter allows 40
navigation requests per minute per client IP, in addition to the existing global
API limiter. Search/place/route responses use `Cache-Control: no-store`.

## Navigation limitations and privacy

This is **foreground browser GPS guidance**, not the native Google Maps application
or a certified navigation device. Background operation, screen-off tracking,
continuous GPS, lane guidance and offline maps are not guaranteed. It does not
include voice guidance or a paid Navigation SDK.

Remaining time is estimated from progress along the selected route; it is refreshed
from the selected provider on a route calculation, not continuously traffic-polled. GPS headings
are shown only when provided by the device. A browser cannot guarantee lane-level
accuracy or detect all road closures. Obey road signs and do not operate controls
while driving. Walking and cycling coverage varies by region.

Do not infer delivery eligibility, pricing, restaurant coverage or proof of delivery
from a route. Those require separate authoritative business rules.

Exact navigation coordinates are sent directly to Mapbox for the requested
search/route. With the optional Google adapter, they pass through the API to Google.
The navigation implementation does not log coordinate payloads or server keys.
Provider terms and applicable privacy requirements apply. Review your public
privacy disclosures and provider content/storage rules; saved destinations are visible to anyone using
the same browser profile and can be removed in the panel.

## Tests and browser checks

```powershell
node --test tests\navigation.test.js
npm.cmd test
npm.cmd run build
```

Navigation tests inject Mapbox and Google transport fixtures to verify request contracts,
server-key isolation, field masks, travel modes, stop ordering, alternatives,
provider errors, quotas, polyline decoding, metre-based route projection, monotonic
progress, shared links, and malformed inputs. These fixtures are used **only in
tests**, never as runtime routing fallbacks.

Browser checks without keys can verify responsive layout, loading/unconfigured
states, add/reorder/remove controls, settings, and disabled start behavior. They
cannot establish real Google service availability.

Implementation checks passed the API regression suite, navigation tests and
production build. Browser checks confirmed no page overflow at 320px and 390px.
Separate browser-only Google/GPS test doubles exercised route loading, off-route
rerouting after an intermediate stop, synchronization of the updated planner,
GPS-watch cleanup on Stop, and saved-destination behavior. Those checks do not
constitute live Google or real-device GPS verification.

For each provider release, verify with its restricted public token or keys:

1. The selected provider's map loads without key/referrer/billing errors at desktop and 320px/390px
   mobile widths; attribution and touch controls remain accessible.
2. Search a known business and resolve a place. Calculate a driving route between
   two real points and check distance, ETA and turn instructions.
3. Select alternatives and verify line highlighting; test walking/cycling where
   supported. Add, reorder and remove stops.
4. On a real authorized device, allow GPS and start navigation. Verify blue dot,
   reported accuracy, available heading, upcoming turn, remaining distance,
   overview/follow and clearing of GPS on Stop/Close.
5. Safely verify off-route rerouting without fabricated production rider positions.
   Test denied location permission, lost GPS, offline state and reconnection.
6. Verify saved destinations and a shared link in another browser. Confirm that
   changing navigation does not change the saved delivery address.

No real-device or authenticated production-order test is claimed by the automated
test suite.

## Optional Google deployment

These steps are not required for the active frontend-only Mapbox release.

1. Deploy the API changes and configure `GOOGLE_NAVIGATION_API_KEY` securely on
   Render. [../render.yaml](../render.yaml) declares this secret without a value.
   No database schema migration is needed for navigation.
2. Confirm API readiness and that navigation endpoints return configured provider
   results, not `NAVIGATION_NOT_CONFIGURED`. Validate keys/billing on staging first.
3. Configure the frontend browser key and vector map ID in the build environment.
   Check referrers for every host you intend to serve.
4. Run the tests and `npm.cmd run build`; frontend environment changes always
   require a rebuild.
5. Deploy the built Worker:

   ```powershell
   npm.cmd run cloudflare:deploy -- --keep-vars
   ```

6. Verify `/navigate`, the lazy-loaded JS/CSS, same-origin API proxy, real search,
   routing and GPS permission flow. Keep the previous Worker version for rollback.
   The existing `/location` delivery picker remains available independently.
