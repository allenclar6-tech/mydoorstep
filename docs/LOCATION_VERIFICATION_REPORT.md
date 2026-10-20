# Sapele candidate locations: verification report

**Date:** 20 October 2026. **Prepared by:** Claude, for DOORSTEP, through desk research only.

## What this is and is not

- This is desk research. Nobody visited any location. No resident, rider or official was contacted. No
  reviewer has confirmed any record.
- The only coordinate source that could be reached from the research environment was **GeoNames**.
  OpenStreetMap, Nominatim, Overpass, Mapbox and Google could not be queried, so **no coordinate was
  cross-checked against a second independent source**.
- **Name-in-use evidence** comes from the Sapele LGA postcode/village listing and INEC polling-unit names. These
  sources confirm that a name is used locally. They give no positions.
- All **17 preliminary coordinates** in the brief match GeoNames records to within about 20 m. They therefore
  come from the same gazetteer and do not count as independent confirmation. The one exception is Ajasolo;
  see its entry.
- **Nothing is marked verified, no boundary is approved, and no location is a delivery zone.** This is
  deliberate. Under the brief's rules, only a map review or a local confirmation recorded by an authorised
  reviewer can change that.
- **Map styles:** the Mapbox map and the pins coloured by status were checked only with the map stubbed out.
  The page layout was rendered at phone and desktop widths. The live Mapbox styles, pins, polygon drawing and
  style switching have **not** been run against real Mapbox here, because no token is available. Test them
  on the live site after deploying.

## Totals

| | Count |
|---|---|
| Candidates imported | 36 |
| Verified | **0** |
| `needs_local_verification` | 17 |
| `needs_review` | 19 |
| With coordinates | 25: 17 preliminary (all matching GeoNames) and 8 from GeoNames only |
| Without coordinates (left empty, not guessed) | 11: Gana, Oton, Amuogodo, Adegbarassa, Ajakimonu, Ajamikawa, Aruowon, Atamua, Ugborhen, Ekeresan, Okokporo |
| Low-precision (whole-minute) coordinates | 3: Atakolo, Ajamangoro, Chemisan |
| Probable duplicate pairs (flagged, **not merged**) | 3: Adagbarassa-Amukpe ↔ Adegbarassa, Ajekimoni ↔ Ajakimonu, Aronwon ↔ Aruowon |
| Other name overlaps flagged for a look | Adagbrasa, Ajasolo (alt. Ekeresa), Ekeresan |
| LGA conflict | Ajasolo: the preliminary point equals a GeoNames record in Warri South LGA |
| More than one GeoNames record with the name | Elume, Ebada/Ibada, Ikwewu (one in Okpe LGA), Okuovu (one "Inland") |
| Display name changed (original kept, admin must approve) | Okopkooro → Okokporo; Ajakaketie → Ajakaketiewe; Ugbokurusu → Ugbukurusu |
| Boundaries approved | 0 |
| Delivery zones active | 0 |
| Distance of pinned places from Sapele centre (5.8916, 5.6846) | 3.8 – 18.8 km |

## What to do next (in this order)

1. Resolve the `needs_review` items: the three duplicate pairs, the Ajasolo LGA conflict, the places with two
   GeoNames records, the low-precision pins, and the name changes.
2. Ask riders who know each area to submit **Local checks** (`/rider/locations`), starting with the places you
   deliver to most.
3. A reviewer accepts good checks, corrects pins, and marks places verified.
4. For each place you will deliver to: draw its boundary, test real addresses inside and outside, approve it,
   then switch deliveries on.
5. Set `LOCATION_REVIEWER_EMAILS` on Render if not every admin should approve.

## Per-candidate findings

### 1. Amukpe

| | |
|---|---|
| Other spellings | Amuokpe |
| Type | TOWN |
| Coordinates | 5.85822, 5.71976 |
| Coordinate origin | Preliminary list (matches GeoNames 2350008 within ~20 m, so not independent) |
| Distance from Sapele centre | 5.4 km |
| Sources | [GeoNames 2350008](https://www.geonames.org/2350008/amukpe.html); [Sapele LGA postcode/village listing (Wikipedia)](https://en.wikipedia.org/wiki/List_of_villages_in_Delta_State); [INEC polling units, Sapele LGA (eduweb.com.ng)](https://www.eduweb.com.ng/full-list-of-polling-unit-numbers-and-id-codes-in-sapele-lga-delta-state/) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_local_verification** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | — |
| Notes | Preliminary coordinates match GeoNames 2350008 (Delta, Sapele) to 5 decimals, so they came from the same record and are not an independent check. Listed in the 331107 Sapele Rural/Amukpe postcode group; "Amuokpe" is the INEC ward spelling. |

### 2. Adagbarassa-Amukpe

| | |
|---|---|
| Other spellings | Adagbarassa Amuokpe, Adagbrassa Amuokpe, Adegbarassa |
| Type | VILLAGE |
| Coordinates | 5.85132, 5.75571 |
| Coordinate origin | Preliminary list (matches GeoNames 2352628 within ~20 m, so not independent) |
| Distance from Sapele centre | 9.1 km |
| Sources | [GeoNames 2352628](https://www.geonames.org/2352628/adagbarassa-amukpe.html); [INEC polling units, Sapele LGA (eduweb.com.ng)](https://www.eduweb.com.ng/full-list-of-polling-unit-numbers-and-id-codes-in-sapele-lga-delta-state/) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_review** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | Shares a name or spelling with another record |
| Notes | Matches GeoNames 2352628. INEC lists "Adagbrassa Amuokpe" in Amuokpe ward. Probably the same community as candidate 25 "Adegbarassa" (postcode list) — needs an admin decision before merging. Distinct from candidate 10 "Adagbrasa" (Elume ward). Possible duplicate of candidate "Adegbarassa" — not merged; needs admin approval. |

### 3. Ajakaketiewe (submitted as “Ajakaketie”)

| | |
|---|---|
| Other spellings | Ajakaketie |
| Type | VILLAGE |
| Coordinates | 5.85442, 5.76989 |
| Coordinate origin | Preliminary list (matches GeoNames 7027886 within ~20 m, so not independent) |
| Distance from Sapele centre | 10.3 km |
| Sources | [GeoNames 7027886](https://www.geonames.org/7027886/ajakaketie.html) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_local_verification** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | — |
| Notes | GeoNames primary name is "Ajakaketiewe" with "Ajakaketie" as an alternate; preliminary coordinates match. Not found in the postcode list or INEC polling-unit names, so local use of the name is unconfirmed. |

### 4. Ebada

| | |
|---|---|
| Other spellings | Ibada, Ibada Amuokpe |
| Type | VILLAGE |
| Coordinates | 5.83249, 5.74855 |
| Coordinate origin | Preliminary list (matches GeoNames 2344155 within ~20 m, so not independent) |
| Distance from Sapele centre | 9.7 km |
| Sources | [GeoNames 2344155](https://www.geonames.org/2344155/ebada.html); [Sapele LGA postcode/village listing (Wikipedia)](https://en.wikipedia.org/wiki/List_of_villages_in_Delta_State); [INEC polling units, Sapele LGA (eduweb.com.ng)](https://www.eduweb.com.ng/full-list-of-polling-unit-numbers-and-id-codes-in-sapele-lga-delta-state/) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_review** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | — |
| Notes | Two GeoNames places carry the name Ebada/Ibada. INEC lists "Ibada Amuokpe" (Amuokpe ward) and "Ibada-Elume" (Elume ward), so there may be two communities. Confirm which one this candidate means. Ambiguity: GeoNames also has "Ibada" (alt. Ebada) at 5.776263, 5.737939 (id 2344156), ~6.3 km south. |

### 5. Egbeku

| | |
|---|---|
| Other spellings | Igbeku, Agbeku |
| Type | VILLAGE |
| Coordinates | 5.80922, 5.75992 |
| Coordinate origin | Preliminary list (matches GeoNames 2343919 within ~20 m, so not independent) |
| Distance from Sapele centre | 12.4 km |
| Sources | [GeoNames 2343919](https://www.geonames.org/2343919/egbeku.html); [Sapele LGA postcode/village listing (Wikipedia)](https://en.wikipedia.org/wiki/List_of_villages_in_Delta_State); [INEC polling units, Sapele LGA (eduweb.com.ng)](https://www.eduweb.com.ng/full-list-of-polling-unit-numbers-and-id-codes-in-sapele-lga-delta-state/) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_local_verification** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | — |
| Notes | Matches GeoNames 2343919. In the 331107 postcode group; INEC spells it Igbeku/Agbeku (Amuokpe ward). |

### 6. Ajekimoni

| | |
|---|---|
| Other spellings | Adjekimoni, Ajakimonu |
| Type | VILLAGE |
| Coordinates | 5.79366, 5.68804 |
| Coordinate origin | Preliminary list (matches GeoNames 7027897 within ~20 m, so not independent) |
| Distance from Sapele centre | 10.9 km |
| Sources | [GeoNames 7027897](https://www.geonames.org/7027897/ajekimoni.html); [INEC polling units, Sapele LGA (eduweb.com.ng)](https://www.eduweb.com.ng/full-list-of-polling-unit-numbers-and-id-codes-in-sapele-lga-delta-state/) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_review** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | Shares a name or spelling with another record |
| Notes | Matches GeoNames 7027897. INEC lists "Efeghren Primary School, Adjekimoni" (Amuokpe ward). Very likely the same community as candidate 26 "Ajakimonu" (postcode-list spelling) — needs an admin decision. Possible duplicate of candidate "Ajakimonu" — not merged; needs admin approval. |

### 7. Akuekpara

| | |
|---|---|
| Other spellings | — |
| Type | VILLAGE |
| Coordinates | 5.7591, 5.74093 |
| Coordinate origin | Preliminary list (matches GeoNames 7027928 within ~20 m, so not independent) |
| Distance from Sapele centre | 16.0 km |
| Sources | [GeoNames 7027928](https://www.geonames.org/7027928/akuekpara.html) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_local_verification** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | — |
| Notes | Matches GeoNames 7027928. Not found in the postcode list or INEC names; local use unconfirmed. |

### 8. Amuegbedi

| | |
|---|---|
| Other spellings | Emuaegbedi |
| Type | VILLAGE |
| Coordinates | 5.76578, 5.71317 |
| Coordinate origin | Preliminary list (matches GeoNames 2350019 within ~20 m, so not independent) |
| Distance from Sapele centre | 14.3 km |
| Sources | [GeoNames 2350019](https://www.geonames.org/2350019/amuegbedi.html); [Sapele LGA postcode/village listing (Wikipedia)](https://en.wikipedia.org/wiki/List_of_villages_in_Delta_State) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_local_verification** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | — |
| Notes | Matches GeoNames 2350019. The postcode list spells it "Emuaegbedi" (331107). |

### 9. Elume

| | |
|---|---|
| Other spellings | — |
| Type | TOWN |
| Coordinates | 5.73715, 5.63722 |
| Coordinate origin | Preliminary list (matches GeoNames 2343384 within ~20 m, so not independent) |
| Distance from Sapele centre | 18.0 km |
| Sources | [GeoNames 2343384](https://www.geonames.org/2343384/elume.html); [Sapele LGA postcode/village listing (Wikipedia)](https://en.wikipedia.org/wiki/List_of_villages_in_Delta_State); [INEC polling units, Sapele LGA (eduweb.com.ng)](https://www.eduweb.com.ng/full-list-of-polling-unit-numbers-and-id-codes-in-sapele-lga-delta-state/) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_review** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | — |
| Notes | Preliminary coordinates match GeoNames 2343384. Elume is the 331109 postcode group and an INEC ward. A second, low-precision GeoNames "Elume" exists — confirm it is a duplicate record, not another place. Ambiguity: GeoNames has a second "Elume" at 5.9, 5.6166667 (id 2343383, rounded to whole minutes), ~18 km north. |

### 10. Adagbrasa

| | |
|---|---|
| Other spellings | Adagbrassa |
| Type | VILLAGE |
| Coordinates | 5.73841, 5.6834 |
| Coordinate origin | Preliminary list (matches GeoNames 7027931 within ~20 m, so not independent) |
| Distance from Sapele centre | 17.0 km |
| Sources | [GeoNames 7027931](https://www.geonames.org/7027931/adagbrasa.html); [INEC polling units, Sapele LGA (eduweb.com.ng)](https://www.eduweb.com.ng/full-list-of-polling-unit-numbers-and-id-codes-in-sapele-lga-delta-state/) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_local_verification** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | Shares a name or spelling with another record |
| Notes | Matches GeoNames 7027931. INEC lists "Adagbrassa Primary School" in Elume ward — a different place from Adagbarassa-Amukpe (Amuokpe ward), ~15 km apart. |

### 11. Degbrode

| | |
|---|---|
| Other spellings | Edegbrode, Edegborode |
| Type | VILLAGE |
| Coordinates | 5.74072, 5.67941 |
| Coordinate origin | Preliminary list (matches GeoNames 2345008 within ~20 m, so not independent) |
| Distance from Sapele centre | 16.8 km |
| Sources | [GeoNames 2345008](https://www.geonames.org/2345008/degbrode.html); [INEC polling units, Sapele LGA (eduweb.com.ng)](https://www.eduweb.com.ng/full-list-of-polling-unit-numbers-and-id-codes-in-sapele-lga-delta-state/) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_local_verification** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | — |
| Notes | Matches GeoNames 2345008. INEC Elume ward lists "Edegbrode"; the spreadsheet lists "Edegborode". Only ~0.5 km from Adagbrasa — check they are separate settlements. |

### 12. Atakolo

| | |
|---|---|
| Other spellings | — |
| Type | VILLAGE |
| Coordinates | 5.83333, 5.7 |
| Coordinate origin | Preliminary list (matches GeoNames 2349040 within ~20 m, so not independent) |
| Distance from Sapele centre | 6.7 km |
| Sources | [GeoNames 2349040](https://www.geonames.org/2349040/atakolo.html) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_review** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | Coordinates rounded to whole minutes (±1–2 km) |
| Notes | GeoNames 2349040 is stored to whole minutes (5°50′N 5°42′E), so it is only accurate to ~1–2 km. Not found in the postcode list or INEC names. |

### 13. Ajasolo

| | |
|---|---|
| Other spellings | Ekeresa |
| Type | VILLAGE |
| Coordinates | 5.79034, 5.57727 |
| Coordinate origin | Preliminary list (see notes for how it relates to GeoNames) |
| Distance from Sapele centre | 16.4 km |
| Sources | [GeoNames 7027895](https://www.geonames.org/7027895/ajasolo.html) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_review** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | Shares a name or spelling with another record |
| Notes | Conflict: the preliminary coordinates match GeoNames 2343724 "Ekeresa" (alternate name Ajasolo), which GeoNames places in Warri South LGA, not Sapele. A separate "Ajasolo" record (7027895, Sapele) is ~170 m away. Confirm which LGA it is in before any use. |

### 14. Ajamangoro

| | |
|---|---|
| Other spellings | — |
| Type | VILLAGE |
| Coordinates | 5.93333, 5.53333 |
| Coordinate origin | Preliminary list (matches GeoNames 2351489 within ~20 m, so not independent) |
| Distance from Sapele centre | 17.4 km |
| Sources | [GeoNames 2351489](https://www.geonames.org/2351489/ajamangoro.html) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_review** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | Coordinates rounded to whole minutes (±1–2 km) |
| Notes | GeoNames 2351489 is rounded to whole minutes (~1–2 km accuracy) and lies ~17 km west of Sapele town. Not in the postcode list or INEC names. Check it is in the delivery service area. |

### 15. Aronwon

| | |
|---|---|
| Other spellings | Aruowon |
| Type | VILLAGE |
| Coordinates | 5.9321, 5.52003 |
| Coordinate origin | Preliminary list (matches GeoNames 2349337 within ~20 m, so not independent) |
| Distance from Sapele centre | 18.8 km |
| Sources | [GeoNames 2349337](https://www.geonames.org/2349337/aronwon.html); [Sapele LGA postcode/village listing (Wikipedia)](https://en.wikipedia.org/wiki/List_of_villages_in_Delta_State) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_review** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | Shares a name or spelling with another record |
| Notes | GeoNames 2349337, ~19 km west of Sapele town. The postcode list has "Aruowon"; the spreadsheet lists "Aruowon/Aronwon" as one place. Probably the same as candidate 28 — needs an admin decision. Possible duplicate of candidate "Aruowon" — not merged; needs admin approval. |

### 16. Bakana

| | |
|---|---|
| Other spellings | Bakama |
| Type | VILLAGE |
| Coordinates | 5.92525, 5.57611 |
| Coordinate origin | Preliminary list (matches GeoNames 2348186 within ~20 m, so not independent) |
| Distance from Sapele centre | 12.6 km |
| Sources | [GeoNames 2348186](https://www.geonames.org/2348186/bakana.html) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_review** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | — |
| Notes | Matches the Delta/Sapele GeoNames record. ~12.5 km west-north-west of Sapele town. Not in the postcode list or INEC names. Ambiguity: Same name in Rivers State (Degema): Bakana 2348185, Old Bakana 2326749 — not this place. |

### 17. Chemisan

| | |
|---|---|
| Other spellings | Jemisan |
| Type | VILLAGE |
| Coordinates | 5.76667, 5.61667 |
| Coordinate origin | Preliminary list (matches GeoNames 2346105 within ~20 m, so not independent) |
| Distance from Sapele centre | 15.8 km |
| Sources | [GeoNames 2346105](https://www.geonames.org/2346105/chemisan.html) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_review** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | Coordinates rounded to whole minutes (±1–2 km) |
| Notes | GeoNames 2346105 (alternate "Jemisan") is rounded to whole minutes (~1–2 km accuracy). Not in the postcode list or INEC names. |

### 18. Gana

| | |
|---|---|
| Other spellings | Ghana |
| Type | NEIGHBOURHOOD |
| Coordinates | — (none found) |
| Coordinate origin | None |
| Distance from Sapele centre | — |
| Sources | [Sapele LGA postcode/village listing (Wikipedia)](https://en.wikipedia.org/wiki/List_of_villages_in_Delta_State); [INEC polling units, Sapele LGA (eduweb.com.ng)](https://www.eduweb.com.ng/full-list-of-polling-unit-numbers-and-id-codes-in-sapele-lga-delta-state/) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_local_verification** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | No map pin |
| Notes | No GeoNames record in Delta (the only "Ghana Quarters" in Delta is in Ukwuani LGA, unrelated). Name confirmed in local use: postcode group 331107 and INEC Sapele Urban VII ward (Gana Road, Gana Mixed Secondary School, Gana Health Centre). Coordinates left empty. |

### 19. Ikwewu

| | |
|---|---|
| Other spellings | Okwewu, Ikwegwu |
| Type | VILLAGE |
| Coordinates | 5.819237, 5.734285 |
| Coordinate origin | GeoNames 2337802 only |
| Distance from Sapele centre | 9.7 km |
| Sources | [GeoNames 2337802](https://www.geonames.org/2337802/ikwewu.html); [Sapele LGA postcode/village listing (Wikipedia)](https://en.wikipedia.org/wiki/List_of_villages_in_Delta_State); [INEC polling units, Sapele LGA (eduweb.com.ng)](https://www.eduweb.com.ng/full-list-of-polling-unit-numbers-and-id-codes-in-sapele-lga-delta-state/) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_review** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | — |
| Notes | Single-source GeoNames coordinates (Sapele record). In postcode group 331107; INEC "Ikwegwu" (Amuokpe ward) is probably the same. Not cross-checked. Ambiguity: A second GeoNames "Ikwewu" (2337803) is in Okpe LGA at 5.614713, 5.863172 — a different place. |

### 20. Ogorode

| | |
|---|---|
| Other spellings | — |
| Type | TOWN |
| Coordinates | 5.919325, 5.646352 |
| Coordinate origin | GeoNames 7027847 only |
| Distance from Sapele centre | 5.2 km |
| Sources | [GeoNames 7027847](https://www.geonames.org/7027847/ogorode.html); [Sapele LGA postcode/village listing (Wikipedia)](https://en.wikipedia.org/wiki/List_of_villages_in_Delta_State); [INEC polling units, Sapele LGA (eduweb.com.ng)](https://www.eduweb.com.ng/full-list-of-polling-unit-numbers-and-id-codes-in-sapele-lga-delta-state/) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_review** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | — |
| Notes | Single-source GeoNames coordinates. Ogorode is both a 331107 rural locality and an urban road district (331262); INEC lists Ogorode/Ogorode-Amuokpe. The pin may represent only part of the area. Not cross-checked. |

### 21. Okirigwre

| | |
|---|---|
| Other spellings | Okirighwre, Okirighuire, Okirighwere, Okirigwe |
| Type | TOWN |
| Coordinates | 5.866119, 5.707247 |
| Coordinate origin | GeoNames 7027856 only |
| Distance from Sapele centre | 3.8 km |
| Sources | [GeoNames 7027856](https://www.geonames.org/7027856/okirighuire.html); [Sapele LGA postcode/village listing (Wikipedia)](https://en.wikipedia.org/wiki/List_of_villages_in_Delta_State); [INEC polling units, Sapele LGA (eduweb.com.ng)](https://www.eduweb.com.ng/full-list-of-polling-unit-numbers-and-id-codes-in-sapele-lga-delta-state/) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_review** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | — |
| Notes | GeoNames lists it as "Okirighuire" (alternate Okirighwre), single source. In postcode group 331107 and INEC (Okirigwre, Okirigwre Garage). Ambiguity: GeoNames "Okirigwe" 2327131 is in Ebonyi State — a different place with a similar name. |

### 22. Okuovwori

| | |
|---|---|
| Other spellings | Okwovwuri |
| Type | VILLAGE |
| Coordinates | 5.8352745, 5.725257 |
| Coordinate origin | GeoNames 2326823 only |
| Distance from Sapele centre | 7.7 km |
| Sources | [GeoNames 2326823](https://www.geonames.org/2326823/okuovwori.html); [Sapele LGA postcode/village listing (Wikipedia)](https://en.wikipedia.org/wiki/List_of_villages_in_Delta_State); [INEC polling units, Sapele LGA (eduweb.com.ng)](https://www.eduweb.com.ng/full-list-of-polling-unit-numbers-and-id-codes-in-sapele-lga-delta-state/) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_local_verification** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | — |
| Notes | Single-source GeoNames coordinates. In postcode group 331107; INEC "Okwovwuri Village" (Amuokpe ward). |

### 23. Oton

| | |
|---|---|
| Other spellings | — |
| Type | NEIGHBOURHOOD |
| Coordinates | — (none found) |
| Coordinate origin | None |
| Distance from Sapele centre | — |
| Sources | [Sapele LGA postcode/village listing (Wikipedia)](https://en.wikipedia.org/wiki/List_of_villages_in_Delta_State); [INEC polling units, Sapele LGA (eduweb.com.ng)](https://www.eduweb.com.ng/full-list-of-polling-unit-numbers-and-id-codes-in-sapele-lga-delta-state/) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_local_verification** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | No map pin |
| Notes | No GeoNames record in Delta (all "Oton" results are in other states). Name confirmed locally: postcode group 331107 and INEC Sapele Urban VII ward (Oton Primary School, Oton Community Townhall). Coordinates left empty. |

### 24. Amuogodo

| | |
|---|---|
| Other spellings | — |
| Type | VILLAGE |
| Coordinates | — (none found) |
| Coordinate origin | None |
| Distance from Sapele centre | — |
| Sources | [Sapele LGA postcode/village listing (Wikipedia)](https://en.wikipedia.org/wiki/List_of_villages_in_Delta_State) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_local_verification** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | No map pin |
| Notes | Listed in postcode group 331107. No GeoNames record. Coordinates left empty. |

### 25. Adegbarassa

| | |
|---|---|
| Other spellings | Adagbarassa-Amukpe, Adagbrassa |
| Type | VILLAGE |
| Coordinates | — (none found) |
| Coordinate origin | None |
| Distance from Sapele centre | — |
| Sources | [Sapele LGA postcode/village listing (Wikipedia)](https://en.wikipedia.org/wiki/List_of_villages_in_Delta_State) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_review** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | No map pin Shares a name or spelling with another record |
| Notes | Postcode-list spelling (331107). No GeoNames record under this spelling. Probably the same community as candidate 2 "Adagbarassa-Amukpe" — needs an admin decision before merging. Coordinates left empty. Possible duplicate of candidate "Adagbarassa-Amukpe" — not merged; needs admin approval. |

### 26. Ajakimonu

| | |
|---|---|
| Other spellings | Ajekimoni, Adjekimoni |
| Type | VILLAGE |
| Coordinates | — (none found) |
| Coordinate origin | None |
| Distance from Sapele centre | — |
| Sources | [Sapele LGA postcode/village listing (Wikipedia)](https://en.wikipedia.org/wiki/List_of_villages_in_Delta_State) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_review** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | No map pin Shares a name or spelling with another record |
| Notes | Postcode-list spelling (331107). No GeoNames record under this spelling. Probably the same as candidate 6 "Ajekimoni" — needs an admin decision. Coordinates left empty. Possible duplicate of candidate "Ajekimoni" — not merged; needs admin approval. |

### 27. Ajamikawa

| | |
|---|---|
| Other spellings | — |
| Type | VILLAGE |
| Coordinates | — (none found) |
| Coordinate origin | None |
| Distance from Sapele centre | — |
| Sources | [Sapele LGA postcode/village listing (Wikipedia)](https://en.wikipedia.org/wiki/List_of_villages_in_Delta_State) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_local_verification** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | No map pin |
| Notes | Listed in postcode group 331107. No GeoNames record. INEC "Igbeku Community Townhall (Ajimikara)" may be related — unconfirmed. Coordinates left empty. |

### 28. Aruowon

| | |
|---|---|
| Other spellings | Aronwon |
| Type | VILLAGE |
| Coordinates | — (none found) |
| Coordinate origin | None |
| Distance from Sapele centre | — |
| Sources | [Sapele LGA postcode/village listing (Wikipedia)](https://en.wikipedia.org/wiki/List_of_villages_in_Delta_State) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_review** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | No map pin Shares a name or spelling with another record |
| Notes | Postcode-list spelling (331107). No GeoNames record under this spelling. Probably the same as candidate 15 "Aronwon" — needs an admin decision. Coordinates left empty. Possible duplicate of candidate "Aronwon" — not merged; needs admin approval. |

### 29. Atamua

| | |
|---|---|
| Other spellings | Etamua |
| Type | VILLAGE |
| Coordinates | — (none found) |
| Coordinate origin | None |
| Distance from Sapele centre | — |
| Sources | [Sapele LGA postcode/village listing (Wikipedia)](https://en.wikipedia.org/wiki/List_of_villages_in_Delta_State) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_local_verification** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | No map pin |
| Notes | Listed in postcode group 331107 (spreadsheet: Etamua/Atamua). No GeoNames record under either spelling. Coordinates left empty. |

### 30. Ugborhen

| | |
|---|---|
| Other spellings | Ugborhewu |
| Type | TOWN |
| Coordinates | — (none found) |
| Coordinate origin | None |
| Distance from Sapele centre | — |
| Sources | [Sapele LGA postcode/village listing (Wikipedia)](https://en.wikipedia.org/wiki/List_of_villages_in_Delta_State); [INEC polling units, Sapele LGA (eduweb.com.ng)](https://www.eduweb.com.ng/full-list-of-polling-unit-numbers-and-id-codes-in-sapele-lga-delta-state/) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_local_verification** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | No map pin |
| Notes | Postcode group 331108 and INEC Okokporo/Ugborhen ward (Ugborhen Town Hall, Ugborhen Primary School, Ugborhewu). No GeoNames record. Coordinates left empty. |

### 31. Ekeresan

| | |
|---|---|
| Other spellings | Ikeresan, Ekeresa |
| Type | VILLAGE |
| Coordinates | — (none found) |
| Coordinate origin | None |
| Distance from Sapele centre | — |
| Sources | [Sapele LGA postcode/village listing (Wikipedia)](https://en.wikipedia.org/wiki/List_of_villages_in_Delta_State); [INEC polling units, Sapele LGA (eduweb.com.ng)](https://www.eduweb.com.ng/full-list-of-polling-unit-numbers-and-id-codes-in-sapele-lga-delta-state/) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_review** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | No map pin Shares a name or spelling with another record |
| Notes | Postcode group 331108; INEC "Ikeresan Primary School" (Okokporo/Ugborhen ward, Sapele). No GeoNames record under "Ekeresan"/"Ikeresan". Coordinates left empty. Ambiguity: GeoNames "Ekeresa" (2343724, alternate Ajasolo) is in Warri South LGA — may or may not be the same place. |

### 32. Okokporo (submitted as “Okopkooro”)

| | |
|---|---|
| Other spellings | Okopkooro, Okogborode |
| Type | VILLAGE |
| Coordinates | — (none found) |
| Coordinate origin | None |
| Distance from Sapele centre | — |
| Sources | [Sapele LGA postcode/village listing (Wikipedia)](https://en.wikipedia.org/wiki/List_of_villages_in_Delta_State); [INEC polling units, Sapele LGA (eduweb.com.ng)](https://www.eduweb.com.ng/full-list-of-polling-unit-numbers-and-id-codes-in-sapele-lga-delta-state/) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_review** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | No map pin |
| Notes | The postcode list spelling "Okopkooro" is flagged as uncertain; INEC uses "Okokporo" (ward name and "Okokporo Primary School, Okogborode"). GeoNames only has "Okokporo Creek" (a stream, 7032031) — not a settlement pin. Display name changed to Okokporo pending admin approval; original kept. Coordinates left empty. |

### 33. Okuodede

| | |
|---|---|
| Other spellings | — |
| Type | VILLAGE |
| Coordinates | 5.761675, 5.681698 |
| Coordinate origin | GeoNames 2326831 only |
| Distance from Sapele centre | 14.5 km |
| Sources | [GeoNames 2326831](https://www.geonames.org/2326831/okuodede.html); [Sapele LGA postcode/village listing (Wikipedia)](https://en.wikipedia.org/wiki/List_of_villages_in_Delta_State); [INEC polling units, Sapele LGA (eduweb.com.ng)](https://www.eduweb.com.ng/full-list-of-polling-unit-numbers-and-id-codes-in-sapele-lga-delta-state/) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_local_verification** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | — |
| Notes | Single-source GeoNames coordinates. Postcode group 331108 and INEC (Okokporo/Ugborhen ward). |

### 34. Okuovu

| | |
|---|---|
| Other spellings | Okuovo |
| Type | VILLAGE |
| Coordinates | 5.769658, 5.663504 |
| Coordinate origin | GeoNames 2326825 only |
| Distance from Sapele centre | 13.8 km |
| Sources | [GeoNames 2326825](https://www.geonames.org/2326825/okuovu.html); [Sapele LGA postcode/village listing (Wikipedia)](https://en.wikipedia.org/wiki/List_of_villages_in_Delta_State); [INEC polling units, Sapele LGA (eduweb.com.ng)](https://www.eduweb.com.ng/full-list-of-polling-unit-numbers-and-id-codes-in-sapele-lga-delta-state/) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_review** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | — |
| Notes | Single-source GeoNames coordinates. Postcode group 331108; INEC "Okuovo Town Hall". Confirm whether Okuovu and Okuovu Inland are one delivery area. Ambiguity: GeoNames also has "Okuovu Inland" (2326824) at 5.761915, 5.660102, ~0.9 km away. |

### 35. Ugbukurusu (submitted as “Ugbokurusu”)

| | |
|---|---|
| Other spellings | Ugbokurusu, Bukurusu, Gbukurusu |
| Type | VILLAGE |
| Coordinates | 5.81884, 5.60282 |
| Coordinate origin | GeoNames 2341332 only |
| Distance from Sapele centre | 12.1 km |
| Sources | [GeoNames 2341332](https://www.geonames.org/2341332/ugbukurusu.html); [Sapele LGA postcode/village listing (Wikipedia)](https://en.wikipedia.org/wiki/List_of_villages_in_Delta_State); [INEC polling units, Sapele LGA (eduweb.com.ng)](https://www.eduweb.com.ng/full-list-of-polling-unit-numbers-and-id-codes-in-sapele-lga-delta-state/) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_local_verification** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | — |
| Notes | GeoNames and INEC both spell it "Ugbukurusu"; the candidate spelling is kept as an alternate. Single-source coordinates. |

### 36. Ogiedi

| | |
|---|---|
| Other spellings | Odjedi, Ogiede, Ogiede-Elume |
| Type | VILLAGE |
| Coordinates | 5.740679, 5.701439 |
| Coordinate origin | GeoNames 2328029 only |
| Distance from Sapele centre | 16.9 km |
| Sources | [GeoNames 2328029](https://www.geonames.org/2328029/ogiedi.html); [Sapele LGA postcode/village listing (Wikipedia)](https://en.wikipedia.org/wiki/List_of_villages_in_Delta_State); [INEC polling units, Sapele LGA (eduweb.com.ng)](https://www.eduweb.com.ng/full-list-of-polling-unit-numbers-and-id-codes-in-sapele-lga-delta-state/) |
| Method | Desk research only (no field visit, no resident contacted) |
| Status | **needs_local_verification** |
| Boundary | none — no coverage drawn or approved |
| Delivery | off |
| Quality flags | — |
| Notes | Single-source GeoNames coordinates. Postcode group 331109 (Elume); INEC "Ogiede Secondary School", "Ogiede-Elume". |

