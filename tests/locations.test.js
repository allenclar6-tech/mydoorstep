import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CANDIDATES, PRELIMINARY_COUNT } from '../server/locationCandidates.js'
import { candidateRecord, coverageContains, deliveryBlockers, deliveryZones, isLocationReviewer, materialChangeEffects, pointInPolygon, qualityFlags, seedCandidateLocations, toCsv, validatePolygon } from '../server/locations.js'
import { zoneForPoint } from '../server/deliveryPricing.js'

// The 17 preliminary coordinates supplied with the brief. They are reference data and must never change.
const PRELIMINARY = { 'Amukpe': [5.85822, 5.71976], 'Adagbarassa-Amukpe': [5.85132, 5.75571], 'Ajakaketie': [5.85442, 5.76989], 'Ebada': [5.83249, 5.74855], 'Egbeku': [5.80922, 5.75992], 'Ajekimoni': [5.79366, 5.68804], 'Akuekpara': [5.7591, 5.74093], 'Amuegbedi': [5.76578, 5.71317], 'Elume': [5.73715, 5.63722], 'Adagbrasa': [5.73841, 5.6834], 'Degbrode': [5.74072, 5.67941], 'Atakolo': [5.83333, 5.7], 'Ajasolo': [5.79034, 5.57727], 'Ajamangoro': [5.93333, 5.53333], 'Aronwon': [5.9321, 5.52003], 'Bakana': [5.92525, 5.57611], 'Chemisan': [5.76667, 5.61667] }
const NO_COORDINATES = ['Gana', 'Oton', 'Amuogodo', 'Adegbarassa', 'Ajakimonu', 'Ajamikawa', 'Aruowon', 'Atamua', 'Ugborhen', 'Ekeresan', 'Okopkooro']

const square = (lat, lng, d = 0.01) => ({ type: 'Polygon', coordinates: [[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]] })
const approved = (extra = {}) => ({ id: 'l1', slug: 'amukpe', name: 'Amukpe', alternativeNames: [], isActive: true, mergedIntoId: null, verificationStatus: 'verified', boundaryVerificationStatus: 'approved', coverageMethod: 'POLYGON', boundaryGeometry: square(5.858, 5.72), latitude: 5.858, longitude: 5.72, deliveryEnabled: true, closedUntil: null, evidence: [{ kind: 'MAP_REVIEW' }], ...extra })

test('all 36 candidates are imported; the 17 preliminary coordinates are kept exactly as supplied', () => {
  assert.equal(CANDIDATES.length, 36)
  assert.deepEqual(CANDIDATES.map((c) => c.n), Array.from({ length: 36 }, (_, i) => i + 1))
  assert.equal(PRELIMINARY_COUNT, 17)
  for (const candidate of CANDIDATES) {
    const record = candidateRecord(candidate)
    if (PRELIMINARY[candidate.original]) {
      assert.deepEqual(candidate.preliminary, PRELIMINARY[candidate.original], candidate.original)
      assert.equal(record.referenceLatitude, PRELIMINARY[candidate.original][0])
      assert.equal(record.referenceLongitude, PRELIMINARY[candidate.original][1])
    } else {
      assert.equal(candidate.preliminary, undefined, `${candidate.original} must not gain preliminary values`)
      assert.equal(record.referenceLatitude, null)
    }
  }
})

test('candidates with no source coordinates are left empty, and nothing is imported as verified or delivering', () => {
  for (const candidate of CANDIDATES) {
    const record = candidateRecord(candidate)
    assert.ok(['needs_review', 'needs_local_verification'].includes(record.verificationStatus), candidate.original)
    assert.equal(record.deliveryEnabled, false)
    assert.equal(record.boundaryVerificationStatus, 'none')
    assert.equal(record.originalCandidateName, candidate.original)
    if (NO_COORDINATES.includes(candidate.original)) { assert.equal(record.latitude, null, candidate.original); assert.equal(record.longitude, null) }
    // Every coordinate traces back to a recorded source.
    if (record.latitude != null) assert.ok(record.evidence.some((entry) => entry.latitude === record.latitude && entry.longitude === record.longitude), candidate.original)
    assert.ok(!record.evidence.some((entry) => ['PHYSICAL_FIELD_CHECK', 'REMOTE_LOCAL_CONFIRMATION', 'MAP_REVIEW'].includes(entry.method)), 'no local confirmation is claimed')
  }
  assert.equal(CANDIDATES.filter((c) => !c.preliminary && !c.geonames).length, NO_COORDINATES.length)
})

test('seeding only adds missing candidates and never overwrites admin changes', async () => {
  const rows = new Map()
  const db = { location: {
    findMany: async ({ where }) => [...rows.values()].filter((row) => where.slug.in.includes(row.slug)).map((row) => ({ slug: row.slug })),
    createMany: async ({ data }) => { for (const row of data) if (!rows.has(row.slug)) rows.set(row.slug, { ...row }) },
  } }
  const first = await seedCandidateLocations(db)
  assert.equal(first.created, 36)
  const amukpe = rows.get('amukpe')
  amukpe.name = 'Amukpe (edited by admin)'; amukpe.verificationStatus = 'verified'
  rows.delete('gana')
  const second = await seedCandidateLocations(db)
  assert.deepEqual([second.created, second.alreadyPresent], [1, 35])
  assert.equal(rows.get('amukpe').name, 'Amukpe (edited by admin)')
  assert.equal(rows.get('amukpe').verificationStatus, 'verified')
})

test('point-in-polygon respects holes and polygon validation rejects bad boundaries', () => {
  const outer = square(5.85, 5.72, 0.02).coordinates[0]
  const hole = square(5.85, 5.72, 0.005).coordinates[0]
  const geometry = { type: 'Polygon', coordinates: [outer, hole] }
  assert.equal(pointInPolygon({ latitude: 5.865, longitude: 5.72 }, geometry), true)
  assert.equal(pointInPolygon({ latitude: 5.85, longitude: 5.72 }, geometry), false, 'inside the hole')
  assert.equal(pointInPolygon({ latitude: 5.90, longitude: 5.72 }, geometry), false)
  assert.equal(validatePolygon(square(5.85, 5.72)), null)
  assert.match(validatePolygon({ type: 'Polygon', coordinates: [[[5.7, 5.8], [5.71, 5.8], [5.7, 5.8]]] }), /3 corners/)
  assert.match(validatePolygon({ type: 'Polygon', coordinates: [[[5.7, 5.8], [5.71, 5.8], [5.71, 5.81], [5.7, 5.81]]] }), /end where it starts/)
  assert.match(validatePolygon({ type: 'Polygon', coordinates: [[[5.7, 95], [5.71, 5.8], [5.71, 5.81], [5.7, 95]]] }), /invalid/)
  assert.match(validatePolygon({ type: 'Polygon', coordinates: [[[5.7, 5.8], [5.71, 5.8], [5.72, 5.8], [5.7, 5.8]]] }), /no area/)
})

test('a location only becomes a delivery zone when verified, coverage-approved, active and switched on', () => {
  assert.deepEqual(deliveryBlockers(approved()), [])
  assert.ok(deliveryBlockers(approved({ verificationStatus: 'needs_review' })).includes('NOT_VERIFIED'))
  assert.ok(deliveryBlockers(approved({ boundaryVerificationStatus: 'needs_review' })).includes('COVERAGE_NOT_APPROVED'))
  assert.ok(deliveryBlockers(approved({ coverageMethod: null })).includes('NO_COVERAGE'))
  assert.ok(deliveryBlockers(approved({ coverageMethod: 'RADIUS', coverageRadiusMeters: 1000 })).includes('RADIUS_NOT_EXPLICITLY_APPROVED'))
  assert.deepEqual(deliveryBlockers(approved({ coverageMethod: 'RADIUS', coverageRadiusMeters: 1000, radiusLimitationsAcceptedById: 'admin-1' })), [])
  assert.ok(deliveryBlockers(approved({ deliveryEnabled: false })).includes('DELIVERY_SWITCHED_OFF'))
  assert.ok(deliveryBlockers(approved({ isActive: false })).includes('INACTIVE'))
  assert.ok(deliveryBlockers(approved({ mergedIntoId: 'l2' })).includes('MERGED'))
  assert.ok(deliveryBlockers(approved({ closedUntil: new Date(Date.now() + 3600_000) })).includes('TEMPORARILY_CLOSED'))
  // The centre pin is not the boundary: a point near the pin but outside the polygon is not covered.
  assert.equal(coverageContains(approved(), { latitude: 5.858, longitude: 5.72 }), true)
  assert.equal(coverageContains(approved(), { latitude: 5.858, longitude: 5.735 }), false)
})

test('moving a pin or changing coverage forces re-verification and switches deliveries off', () => {
  const before = approved()
  const small = materialChangeEffects(before, { latitude: 5.8582, longitude: 5.72 })
  assert.deepEqual(small.reasons, [], 'a ~20 m nudge is not material')
  const moved = materialChangeEffects(before, { latitude: 5.86, longitude: 5.72 })
  assert.deepEqual(moved.reasons, ['PIN_MOVED'])
  assert.equal(moved.effects.verificationStatus, 'needs_review')
  assert.equal(moved.effects.boundaryVerificationStatus, 'draft')
  assert.equal(moved.effects.deliveryEnabled, false)
  const redrawn = materialChangeEffects(before, { boundaryGeometry: square(5.858, 5.72, 0.02) })
  assert.deepEqual(redrawn.reasons, ['COVERAGE_CHANGED'])
  assert.equal(redrawn.effects.verificationStatus, undefined)
  assert.equal(redrawn.effects.deliveryEnabled, false)
})

test('quality checks flag duplicates, shared coordinates, low precision, missing pins and sources', () => {
  const rows = [
    { id: 'a', name: 'Aronwon', alternativeNames: ['Aruowon'], latitude: 5.9321, longitude: 5.52003, verificationStatus: 'needs_review', evidence: [{}] },
    { id: 'b', name: 'Aruowon', alternativeNames: [], latitude: null, longitude: null, verificationStatus: 'needs_review', evidence: [] },
    { id: 'c', name: 'Atakolo', alternativeNames: [], latitude: 5.83333, longitude: 5.7, verificationStatus: 'needs_review', evidence: [{}] },
    { id: 'd', name: 'Copy', alternativeNames: [], latitude: 5.83334, longitude: 5.70001, verificationStatus: 'needs_review', evidence: [{}] },
    { id: 'e', name: 'Far', alternativeNames: [], latitude: 6.5, longitude: 5.68, verificationStatus: 'needs_review', evidence: [{}] },
    { ...approved({ id: 'f', name: 'Live', boundaryVerificationStatus: 'draft' }) },
  ]
  const flags = qualityFlags(rows)
  assert.ok(flags.a.includes('POSSIBLE_DUPLICATE') && flags.b.includes('POSSIBLE_DUPLICATE'))
  assert.ok(flags.b.includes('MISSING_COORDINATES') && flags.b.includes('MISSING_SOURCE'))
  assert.ok(flags.c.includes('LOW_PRECISION_COORDINATES') && flags.c.includes('SAME_COORDINATES_AS_ANOTHER'))
  assert.ok(flags.e.includes('OUTSIDE_SERVICE_AREA'))
  assert.ok(flags.f.includes('BOUNDARY_UNVERIFIED') && flags.f.includes('ACTIVE_WITHOUT_APPROVAL'))
  // The imported candidate list itself: the three suspected duplicate pairs are flagged, not merged.
  const imported = CANDIDATES.map((candidate) => ({ id: candidate.original, ...candidateRecord(candidate) }))
  const importedFlags = qualityFlags(imported)
  for (const name of ['Adagbarassa-Amukpe', 'Adegbarassa', 'Ajekimoni', 'Ajakimonu', 'Aronwon', 'Aruowon']) assert.ok(importedFlags[name].includes('POSSIBLE_DUPLICATE'), name)
  assert.ok(imported.every((row) => !importedFlags[row.id].includes('ACTIVE_WITHOUT_APPROVAL')))
})

test('only approved, active, delivery-enabled locations reach pricing, and pricing uses their real boundary', async () => {
  let where
  const db = { location: { findMany: async (query) => { where = query.where; return [approved(), approved({ id: 'l2', slug: 'shut', name: 'Shut', closedUntil: new Date(Date.now() + 3600_000), closedReason: 'flooding' })] } } }
  const zones = await deliveryZones(db)
  assert.deepEqual(where, { isActive: true, deliveryEnabled: true, verificationStatus: 'verified', boundaryVerificationStatus: 'approved', mergedIntoId: null })
  assert.equal(zones.length, 2)
  assert.equal(zones[1].closed, true)
  assert.equal(zoneForPoint({ latitude: 5.858, longitude: 5.72 }, [zones[0]])?.id, 'amukpe')
  assert.equal(zoneForPoint({ latitude: 5.858, longitude: 5.735 }, [zones[0]]), null, 'outside the drawn boundary even though within 1.5 km of the pin')
})

test('CSV export escapes values; reviewer permission can be limited to named emails', () => {
  const csv = toCsv([{ name: 'Okokporo, "new"', alternativeNames: ['Okopkooro'], qualityFlags: ['MISSING_COORDINATES'] }])
  const [header, line] = csv.trim().split(/\r?\n/)
  assert.ok(header.startsWith('candidateNumber,slug,name'))
  assert.ok(line.includes('"Okokporo, ""new"""'))
  assert.equal(isLocationReviewer({ role: 'ADMIN', email: 'a@x.ng' }, {}), true)
  assert.equal(isLocationReviewer({ role: 'RIDER', email: 'a@x.ng' }, {}), false)
  assert.equal(isLocationReviewer({ role: 'ADMIN', email: 'a@x.ng' }, { LOCATION_REVIEWER_EMAILS: 'b@x.ng' }), false)
  assert.equal(isLocationReviewer({ role: 'ADMIN', email: 'B@x.ng' }, { LOCATION_REVIEWER_EMAILS: 'b@x.ng, c@x.ng' }), true)
})
