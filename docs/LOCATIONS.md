# Sapele location directory and delivery zones

Admin › **Locations** (`/admin/locations`) is the single place where DOORSTEP decides which Sapele places exist,
where they are, how sure we are, and which of them are delivery zones. Rider › **Local checks**
(`/rider/locations`) lets riders who know the area report corrections.

## The rule

A location affects delivery (fees, availability, minimums, closures, rider bonuses) **only** when it is:

1. `verificationStatus = verified`,
2. its delivery coverage is approved (`boundaryVerificationStatus = approved`), as a drawn polygon or a radius
   whose limitations a reviewer explicitly accepted,
3. active, not merged, with a centre pin, and
4. switched on (`deliveryEnabled`).

`deliveryBlockers()` in `server/locations.js` returns the reasons a location fails. The same check runs on the
server when a reviewer tries to switch deliveries on, and `deliveryZones()` is the only source of zones for
pricing (`server/deliveryQuote.js`). Nothing reads zones from the old pricing settings any more.

## Statuses

| Status | Meaning |
|---|---|
| `pending` | Added, nothing checked yet. |
| `needs_review` | There is a conflict, a probable duplicate, low-precision or single-source coordinates, or an LGA question. An admin must look before anything else. |
| `needs_local_verification` | Name and rough position are plausible from published sources, but someone who knows the place must confirm it. |
| `verified` | A reviewer confirmed it with recorded evidence from a map review or a local (remote or physical) check. Imported data or desk research alone cannot produce this status; the server refuses it. |
| `rejected` | Not a real, distinct or in-scope place. |

The centre pin and the delivery boundary are verified separately. A verified place with no approved coverage
is flagged `BOUNDARY_UNVERIFIED`.

## Evidence

Every record has an `evidence` list: `{ kind, source, url?, method, latitude?, longitude?, note?, checkedAt, by }`.
Imported candidates carry `REFERENCE` (the preliminary coordinates from the brief), `GAZETTEER` (GeoNames) and
`NAME_IN_USE` (postcode list / INEC polling units) entries. Admins add more from the detail panel. Accepted
rider checks and coverage tests are stored as evidence too.

## Local confirmation workflow

1. A rider (or an admin) opens **Local checks**, picks a place, says whether they checked **on site** or
   **remotely**, confirms or corrects the name, optionally places a pin, adds a landmark, and describes what
   they checked. This creates a `LocationReview` with status `SUBMITTED`. It changes nothing.
2. A reviewer accepts or declines it. If accepted, it becomes evidence. The reviewer can apply the suggested
   name and pin. Moving the pin more than 100 m resets verification.
3. The reviewer then records a verification decision (status + method + notes).

## Coverage

- **Polygon:** draw corners on the map and submit. The server validates the ring.
- **Radius:** allowed, but approval requires the reviewer to tick "I accept that a circle is not a real
  boundary…". Otherwise the location stays blocked with `RADIUS_NOT_EXPLICITLY_APPROVED`.
- Approval requires at least one sample address expected **inside** and one expected **outside**, tested
  **after** the last coverage change, all behaving as expected.
- Changing the pin (>100 m) or the coverage sends coverage back to `draft` and switches deliveries off.

## Reviewers

Verification, rejection, coverage approval, merging and switching deliveries on need a reviewer. A reviewer is
an ADMIN. If the Render env var `LOCATION_REVIEWER_EMAILS` (comma-separated) is set, only those admins can
review. Other admins can still edit and submit. Every change is written to `AuditLog` with
`entityType = 'Location'` and shows in the record's History.

## Duplicates and hierarchy

- Probable duplicates are flagged, never merged automatically. Merging needs a reviewer, a confirmation tick
  and notes. The merged record's names become alternative spellings of the target, and evidence moves with
  them. The old record stays (inactive, `mergedIntoId` set) for history.
- `parentId` links a street, estate or quarter to its town or community.

## Seed

`server/migrate.js` runs `seedCandidateLocations()` after migrations on every deploy. It creates only the
candidates whose slug is missing and never updates an existing row, so admin edits survive. Deleting a
candidate row brings it back on the next deploy; reject it instead. The admin page also has an
**Import candidate list** button that does the same thing.

## Pricing and checkout

- A customer pin inside an approved zone gets that zone's surcharge, rider bonus, minimum order and closure.
- A typed area name with no pin is priced from an approved zone's centre as an estimate only. The order still
  asks for an exact pin, and the rider app never navigates to a community centre. If there is no customer
  pin, it shows the landmark and says so.
- **Delivery pricing › Areas** has "Only accept addresses inside approved zones". It is off by default. While
  no zones are approved, turning it on would refuse every checkout, so leave it off until zones exist.
- Agreed route prices now reference location slugs.

**Changed behaviour:** area surcharges and bonuses that were typed into the old Delivery pricing › Areas list
no longer apply. Only approved Location zones count. Distance pricing for pinned addresses is unchanged.

## Quality checks

`qualityFlags()`: missing or invalid coordinates, outside the 25 km service area, low-precision (whole-minute)
coordinates, missing source, possible duplicate name or spelling, another record within 25 m, verified without
approved coverage, delivering without approval.

## Export

`GET /api/admin/locations/export?format=csv|json` (buttons on the page): every field, plus quality flags and
evidence count.

## Files

- `server/locationCandidates.js`: the 36 candidates and the research behind them
- `server/locations.js`: rules, geometry, seed, zones, CSV
- `server/locationRoutes.js`: API
- `prisma/migrations/20261020180000_location_directory`: tables
- `src/admin/LocationsAdmin.jsx`, `src/admin/LocationsMap.jsx`, `src/admin/locationsAdmin.css`
- `src/rider/LocationReviews.jsx`
- `tests/locations.test.js`
- `docs/LOCATION_VERIFICATION_REPORT.md`: per-candidate findings
