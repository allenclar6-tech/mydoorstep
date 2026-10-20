// Sapele location directory rules: verification statuses, delivery coverage, eligibility, quality checks and
// the safe seed of the 36 candidate locations. Pure functions are exported for tests; database helpers take `db`.
import { CANDIDATES, CHECKED_ON, SOURCES } from './locationCandidates.js'

export const VERIFICATION_STATUSES = ['pending', 'needs_review', 'needs_local_verification', 'verified', 'rejected']
export const VERIFICATION_METHODS = {
  IMPORT_REFERENCE: 'Imported reference data (not a check)',
  DESK_RESEARCH: 'Desk research in published sources',
  MAP_REVIEW: 'Reviewed on the map against roads/landmarks',
  REMOTE_LOCAL_CONFIRMATION: 'Confirmed remotely by someone who knows the area',
  PHYSICAL_FIELD_CHECK: 'Physically checked on site',
}
export const BOUNDARY_STATUSES = ['none', 'draft', 'needs_review', 'approved', 'rejected']
export const LOCALITY_TYPES = ['LGA', 'TOWN', 'VILLAGE', 'COMMUNITY', 'QUARTER', 'NEIGHBOURHOOD', 'STREET', 'ESTATE', 'LANDMARK', 'UNKNOWN']
export const SAPELE_CENTRE = { latitude: 5.8916, longitude: 5.6846 }
export const SERVICE_AREA_KM = 25
export const MATERIAL_MOVE_METERS = 100

export const slug = (value) => String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'location'
export const normName = (value) => String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '')
const num = (value) => (value == null || value === '' ? null : Number(value))

export function haversineMeters(a, b) {
  const rad = (value) => value * Math.PI / 180
  const dLat = rad(b.latitude - a.latitude)
  const dLng = rad(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h))
}

export function validCoordinates(latitude, longitude) {
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180 && !(latitude === 0 && longitude === 0)
}
export function pointOf(record) {
  const latitude = num(record?.latitude)
  const longitude = num(record?.longitude)
  return validCoordinates(latitude, longitude) ? { latitude, longitude } : null
}

/* ------------------------------ coverage geometry ------------------------------ */
function inRing(point, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if ((yi > point.latitude) !== (yj > point.latitude) && point.longitude < ((xj - xi) * (point.latitude - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
/** GeoJSON Polygon / MultiPolygon containment (holes respected). Coordinates are [longitude, latitude]. */
export function pointInPolygon(point, geometry) {
  if (!point || !geometry) return false
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : []
  return polygons.some(([outer, ...holes]) => inRing(point, outer) && !holes.some((hole) => inRing(point, hole)))
}

/** Checks a drawn boundary: a closed ring of at least 3 distinct valid points with a non-trivial area. */
export function validatePolygon(geometry) {
  if (!geometry || geometry.type !== 'Polygon' || !Array.isArray(geometry.coordinates) || !Array.isArray(geometry.coordinates[0])) return 'Draw the boundary as one polygon.'
  const ring = geometry.coordinates[0]
  if (ring.length < 4) return 'A boundary needs at least 3 corners.'
  if (ring.some((pair) => !Array.isArray(pair) || pair.length < 2 || !validCoordinates(pair[1], pair[0]))) return 'A boundary corner has invalid coordinates.'
  const [first, last] = [ring[0], ring.at(-1)]
  if (first[0] !== last[0] || first[1] !== last[1]) return 'The boundary must end where it starts.'
  let area = 0
  for (let i = 0; i < ring.length - 1; i += 1) area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  if (Math.abs(area) < 1e-8) return 'The boundary has no area.'
  if (ring.length > 501) return 'The boundary has too many corners (max 500).'
  return null
}

export function coverageContains(location, point) {
  if (!point) return false
  if (location.coverageMethod === 'POLYGON') return pointInPolygon(point, location.boundaryGeometry)
  if (location.coverageMethod === 'RADIUS') { const centre = pointOf(location); return Boolean(centre && location.coverageRadiusMeters && haversineMeters(centre, point) <= location.coverageRadiusMeters) }
  return false
}

/* ---------------------------------- eligibility --------------------------------- */
/** Why a location can or cannot be used for automatic delivery decisions. */
export function deliveryBlockers(location, { now = new Date(), ignoreSwitch = false } = {}) {
  const reasons = []
  if (!location.isActive) reasons.push('INACTIVE')
  if (location.mergedIntoId) reasons.push('MERGED')
  if (location.verificationStatus !== 'verified') reasons.push('NOT_VERIFIED')
  if (location.boundaryVerificationStatus !== 'approved') reasons.push('COVERAGE_NOT_APPROVED')
  if (!location.coverageMethod) reasons.push('NO_COVERAGE')
  if (location.coverageMethod === 'RADIUS' && !location.radiusLimitationsAcceptedById) reasons.push('RADIUS_NOT_EXPLICITLY_APPROVED')
  if (location.coverageMethod === 'POLYGON' && validatePolygon(location.boundaryGeometry)) reasons.push('INVALID_BOUNDARY')
  if (!pointOf(location)) reasons.push('NO_CENTRE_PIN')
  if (!ignoreSwitch && !location.deliveryEnabled) reasons.push('DELIVERY_SWITCHED_OFF')
  if (!ignoreSwitch && location.closedUntil && new Date(location.closedUntil) > now) reasons.push('TEMPORARILY_CLOSED')
  return reasons
}
export const BLOCKER_TEXT = {
  INACTIVE: 'This location is deactivated.',
  MERGED: 'This record was merged into another location.',
  NOT_VERIFIED: 'The location is not verified yet.',
  COVERAGE_NOT_APPROVED: 'Its delivery coverage has not been approved.',
  NO_COVERAGE: 'No delivery coverage has been drawn.',
  RADIUS_NOT_EXPLICITLY_APPROVED: 'A circular radius is used, and its limitations have not been explicitly accepted by a reviewer.',
  INVALID_BOUNDARY: 'The drawn boundary is invalid.',
  NO_CENTRE_PIN: 'It has no map pin.',
  DELIVERY_SWITCHED_OFF: 'Deliveries are switched off for this location.',
  TEMPORARILY_CLOSED: 'Deliveries here are temporarily paused.',
}

/**
 * A coordinate move over 100 m, or any change to the coverage, cancels approval: the record must be
 * re-verified (and coverage re-approved) before it is used for delivery again.
 */
export function materialChangeEffects(before, patch) {
  const effects = {}
  const reasons = []
  if (patch.latitude !== undefined || patch.longitude !== undefined) {
    const was = pointOf(before)
    const now = pointOf({ latitude: patch.latitude ?? before.latitude, longitude: patch.longitude ?? before.longitude })
    if ((was && now && haversineMeters(was, now) > MATERIAL_MOVE_METERS) || (was && !now) || (!was && now && before.verificationStatus === 'verified')) reasons.push('PIN_MOVED')
  }
  const coverageKeys = ['coverageMethod', 'boundaryGeometry', 'coverageRadiusMeters']
  if (coverageKeys.some((key) => patch[key] !== undefined && JSON.stringify(patch[key] ?? null) !== JSON.stringify(before[key] ?? null))) reasons.push('COVERAGE_CHANGED')
  if (reasons.includes('PIN_MOVED') && before.verificationStatus === 'verified') effects.verificationStatus = 'needs_review'
  if (reasons.length && ['approved', 'needs_review'].includes(before.boundaryVerificationStatus)) Object.assign(effects, { boundaryVerificationStatus: 'draft', boundaryApprovedById: null, boundaryApprovedAt: null, radiusLimitationsAcceptedById: null })
  if (reasons.length && before.deliveryEnabled) effects.deliveryEnabled = false
  return { reasons, effects }
}

/* -------------------------------- quality checks -------------------------------- */
export function qualityFlags(locations, { now = new Date() } = {}) {
  const live = locations.filter((location) => !location.mergedIntoId && location.verificationStatus !== 'rejected')
  const names = new Map()
  for (const location of live) for (const value of [location.name, ...(location.alternativeNames || [])]) {
    const key = normName(value)
    if (!key) continue
    names.set(key, [...(names.get(key) || []), location.id])
  }
  return Object.fromEntries(locations.map((location) => {
    const flags = []
    const point = pointOf(location)
    const lat = num(location.latitude)
    const lng = num(location.longitude)
    if (lat == null || lng == null) flags.push('MISSING_COORDINATES')
    else if (!validCoordinates(lat, lng)) flags.push('INVALID_COORDINATES')
    if (point && haversineMeters(point, SAPELE_CENTRE) > SERVICE_AREA_KM * 1000) flags.push('OUTSIDE_SERVICE_AREA')
    if (point && Math.abs(lat * 60 - Math.round(lat * 60)) < 5e-4 && Math.abs(lng * 60 - Math.round(lng * 60)) < 5e-4) flags.push('LOW_PRECISION_COORDINATES')
    const evidence = Array.isArray(location.evidence) ? location.evidence : []
    if (!evidence.length && !location.verificationSource) flags.push('MISSING_SOURCE')
    if (!location.mergedIntoId && location.verificationStatus !== 'rejected') {
      const dupes = new Set([location.name, ...(location.alternativeNames || [])].flatMap((value) => (names.get(normName(value)) || [])).filter((id) => id !== location.id))
      if (dupes.size) flags.push('POSSIBLE_DUPLICATE')
      if (point && live.some((other) => other.id !== location.id && pointOf(other) && haversineMeters(point, pointOf(other)) < 25)) flags.push('SAME_COORDINATES_AS_ANOTHER')
    }
    if (location.verificationStatus === 'verified' && location.boundaryVerificationStatus !== 'approved') flags.push('BOUNDARY_UNVERIFIED')
    if (location.deliveryEnabled && deliveryBlockers(location, { now, ignoreSwitch: true }).length) flags.push('ACTIVE_WITHOUT_APPROVAL')
    return [location.id, flags]
  }))
}
export const FLAG_TEXT = {
  MISSING_COORDINATES: 'No map pin',
  INVALID_COORDINATES: 'Invalid coordinates',
  OUTSIDE_SERVICE_AREA: `More than ${SERVICE_AREA_KM} km from Sapele town`,
  LOW_PRECISION_COORDINATES: 'Coordinates rounded to whole minutes (±1–2 km)',
  MISSING_SOURCE: 'No source recorded',
  POSSIBLE_DUPLICATE: 'Shares a name or spelling with another record',
  SAME_COORDINATES_AS_ANOTHER: 'Pin within 25 m of another record',
  BOUNDARY_UNVERIFIED: 'Verified, but coverage not approved',
  ACTIVE_WITHOUT_APPROVAL: 'Delivery on without full approval',
}

/* ------------------------------------ seed ------------------------------------- */
/** Database record for one candidate, built only from the documented research (nothing invented). */
export function candidateRecord(candidate) {
  const evidence = []
  if (candidate.preliminary) evidence.push({ kind: 'REFERENCE', source: 'Preliminary coordinates supplied with the DOORSTEP brief (unverified)', latitude: candidate.preliminary[0], longitude: candidate.preliminary[1], checkedAt: CHECKED_ON, method: 'IMPORT_REFERENCE', by: 'import' })
  if (candidate.geonames) evidence.push({ kind: 'GAZETTEER', source: `GeoNames ${candidate.geonames.id} (${candidate.geonames.admin})`, url: candidate.geonames.url, latitude: candidate.geonames.lat, longitude: candidate.geonames.lng, checkedAt: CHECKED_ON, method: 'DESK_RESEARCH', by: 'Claude (desk research for DOORSTEP)', note: candidate.preliminary ? 'Same coordinates as the preliminary reference — not an independent cross-check.' : 'Single source; not cross-checked with a second independent dataset.' })
  for (const key of candidate.sources || []) evidence.push({ kind: 'NAME_IN_USE', source: SOURCES[key].name, url: SOURCES[key].url, checkedAt: CHECKED_ON, method: 'DESK_RESEARCH', by: 'Claude (desk research for DOORSTEP)', note: 'Confirms the name is listed in Sapele LGA; gives no coordinates.' })
  const notes = [candidate.notes, candidate.ambiguity && `Ambiguity: ${candidate.ambiguity}`, candidate.duplicateOf && `Possible duplicate of candidate "${candidate.duplicateOf}" — not merged; needs admin approval.`].filter(Boolean).join(' ')
  const pin = candidate.preliminary || (candidate.geonames ? [candidate.geonames.lat, candidate.geonames.lng] : null)
  return {
    slug: slug(candidate.original),
    candidateNumber: candidate.n,
    name: candidate.name,
    originalCandidateName: candidate.original,
    alternativeNames: [...new Set((candidate.alt || []).filter((value) => normName(value) !== normName(candidate.name)))],
    localityType: candidate.type || 'UNKNOWN',
    latitude: pin ? pin[0] : null,
    longitude: pin ? pin[1] : null,
    referenceLatitude: candidate.preliminary ? candidate.preliminary[0] : null,
    referenceLongitude: candidate.preliminary ? candidate.preliminary[1] : null,
    referenceSource: candidate.preliminary ? 'Preliminary list supplied by DOORSTEP (unverified)' : null,
    verificationStatus: candidate.status,
    verificationMethod: 'DESK_RESEARCH',
    verificationSource: candidate.geonames ? `GeoNames ${candidate.geonames.id}` : (candidate.sources || []).map((key) => SOURCES[key].name).join('; ') || null,
    verificationSourceUrl: candidate.geonames?.url || (candidate.sources?.[0] ? SOURCES[candidate.sources[0]].url : null),
    verificationCheckedAt: new Date(`${CHECKED_ON}T12:00:00Z`),
    verificationNotes: notes,
    evidence,
    boundaryVerificationStatus: 'none',
    isActive: true,
    deliveryEnabled: false,
  }
}

/**
 * Imports the 36 candidates. Repeatable: records that already exist (matched by slug of the original candidate
 * name) are never touched, so administrator edits and approvals are preserved.
 */
export async function seedCandidateLocations(db) {
  const records = CANDIDATES.map(candidateRecord)
  const existing = await db.location.findMany({ where: { slug: { in: records.map((record) => record.slug) } }, select: { slug: true } })
  const have = new Set(existing.map((row) => row.slug))
  const missing = records.filter((record) => !have.has(record.slug))
  if (missing.length) await db.location.createMany({ data: missing, skipDuplicates: true })
  return { candidates: records.length, created: missing.length, alreadyPresent: have.size }
}

/* ------------------------------- pricing bridge -------------------------------- */
/** Approved, active, delivery-enabled locations as zones for the pricing engine (closed ones are flagged). */
export async function deliveryZones(db, { now = new Date() } = {}) {
  const rows = await db.location.findMany({ where: { isActive: true, deliveryEnabled: true, verificationStatus: 'verified', boundaryVerificationStatus: 'approved', mergedIntoId: null } })
  return rows.filter((row) => !deliveryBlockers(row, { now, ignoreSwitch: true }).length).map((row) => ({
    id: row.slug,
    locationId: row.id,
    name: row.name,
    latitude: num(row.latitude),
    longitude: num(row.longitude),
    coverageMethod: row.coverageMethod,
    boundaryGeometry: row.boundaryGeometry,
    radiusMeters: row.coverageRadiusMeters,
    coverageRadiusMeters: row.coverageRadiusMeters,
    customerSurchargeMinor: row.customerSurchargeMinor,
    riderBonusMinor: row.riderBonusMinor,
    minimumOrderMinor: row.minimumOrderMinor,
    closed: Boolean(row.closedUntil && new Date(row.closedUntil) > now),
    closedReason: row.closedReason,
    closedUntil: row.closedUntil,
    active: true,
  }))
}

/* ------------------------------------ export ------------------------------------ */
export const EXPORT_FIELDS = ['candidateNumber', 'slug', 'name', 'originalCandidateName', 'alternativeNames', 'state', 'localGovernmentArea', 'localityType', 'latitude', 'longitude', 'referenceLatitude', 'referenceLongitude', 'referenceSource', 'nearestLandmark', 'verificationStatus', 'verificationMethod', 'verificationSource', 'verificationSourceUrl', 'verificationCheckedAt', 'verificationNotes', 'reviewerId', 'boundaryVerificationStatus', 'coverageMethod', 'coverageRadiusMeters', 'isActive', 'deliveryEnabled', 'customerSurchargeMinor', 'riderBonusMinor', 'minimumOrderMinor', 'closedUntil', 'mergedIntoId', 'qualityFlags', 'evidenceCount', 'createdAt', 'updatedAt']
export function toCsv(rows) {
  const cell = (value) => {
    const text = value == null ? '' : Array.isArray(value) ? value.join('; ') : value instanceof Date ? value.toISOString() : String(value)
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return [EXPORT_FIELDS.join(','), ...rows.map((row) => EXPORT_FIELDS.map((field) => cell(row[field])).join(','))].join('\r\n')
}

/* ----------------------------------- reviewers ---------------------------------- */
/** Who may approve verification, coverage and delivery activation. LOCATION_REVIEWER_EMAILS narrows it. */
export function isLocationReviewer(user, env = process.env) {
  if (user?.role !== 'ADMIN') return false
  const list = String(env.LOCATION_REVIEWER_EMAILS || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)
  return !list.length || list.includes(String(user.email || '').toLowerCase())
}
export const reviewersRestricted = (env = process.env) => Boolean(String(env.LOCATION_REVIEWER_EMAILS || '').trim())
