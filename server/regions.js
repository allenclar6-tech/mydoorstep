// DOORSTEP regional directory: the official Local Government Area (LGA) registry for Delta, Edo and Rivers, place
// labels, search ranking, and the CSV import checks for the location directory. Where DOORSTEP delivers is decided
// by server/coverage.js; this file is about the directory of places. Pure functions (no express), unit-tested.
//
// Rules this file keeps:
// - Only official LGA NAMES are listed. No coordinates, headquarters, streets or villages are invented here.
// - Nothing here is "verified": LGA records start as pending, with deliveries off.
// - Imported rows never become verified, and never switch deliveries on.
import { LOCALITY_TYPES, normName, slug, validCoordinates } from './locations.js'

export const LGA_SOURCES = {
  Delta: { name: 'Wikipedia — Delta State (Local Government Areas)', url: 'https://en.wikipedia.org/wiki/Delta_State' },
  Edo: { name: 'City Population — Edo State: Local Government Areas', url: 'https://citypopulation.de/en/nigeria/admin/NGA012__edo/' },
  Rivers: { name: 'Wikipedia — Rivers State (Local Government Areas)', url: 'https://en.wikipedia.org/wiki/Rivers_State' },
}
export const LGA_CHECKED_ON = '2026-11-03'

/** Official LGA names per state (Delta 25, Edo 18, Rivers 23). Names only. */
export const LGA_REGISTRY = {
  Delta: ['Aniocha North', 'Aniocha South', 'Bomadi', 'Burutu', 'Ethiope East', 'Ethiope West', 'Ika North East', 'Ika South', 'Isoko North', 'Isoko South', 'Ndokwa East', 'Ndokwa West', 'Okpe', 'Oshimili North', 'Oshimili South', 'Patani', 'Sapele', 'Udu', 'Ughelli North', 'Ughelli South', 'Ukwuani', 'Uvwie', 'Warri North', 'Warri South', 'Warri South West'],
  Edo: ['Akoko-Edo', 'Egor', 'Esan Central', 'Esan North East', 'Esan South East', 'Esan West', 'Etsako Central', 'Etsako East', 'Etsako West', 'Igueben', 'Ikpoba-Okha', 'Oredo', 'Orhionmwon', 'Ovia North East', 'Ovia South West', 'Owan East', 'Owan West', 'Uhunmwonde'],
  Rivers: ['Abua/Odual', 'Ahoada East', 'Ahoada West', 'Akuku-Toru', 'Andoni', 'Asari-Toru', 'Bonny', 'Degema', 'Eleme', 'Emohua', 'Etche', 'Gokana', 'Ikwerre', 'Khana', 'Obio/Akpor', 'Ogba/Egbema/Ndoni', 'Ogu/Bolo', 'Okrika', 'Omuma', 'Opobo/Nkoro', 'Oyigbo', 'Port Harcourt', 'Tai'],
}
export const STATES = Object.keys(LGA_REGISTRY)
// Common spellings people type. Matching also ignores spaces, hyphens and slashes ("Obio-Akpor" = "Obio/Akpor").
const LGA_ALIASES = { portharcourtcity: 'Port Harcourt', phc: 'Port Harcourt', ph: 'Port Harcourt', warrisouthwest: 'Warri South West', warriswest: 'Warri South West', ikanortheast: 'Ika North East', ikane: 'Ika North East' }

/** "delta state" / "DELTA" → "Delta"; unknown → null. */
export function matchState(value) {
  const key = normName(String(value || '').replace(/\bstate\b/i, ''))
  return STATES.find((state) => normName(state) === key) || null
}
/** Canonical LGA name for a state, or null when it isn't an official LGA of that state. */
export function matchLga(state, value) {
  const canonical = matchState(state)
  if (!canonical) return null
  const key = normName(String(value || '').replace(/\b(lga|local government( area)?)\b/ig, ''))
  if (!key) return null
  const alias = LGA_ALIASES[key]
  return LGA_REGISTRY[canonical].find((lga) => normName(lga) === key || lga === alias) || null
}
/** Which states an LGA name exists in (for telling same-named places apart). */
export const statesWithLga = (value) => STATES.filter((state) => matchLga(state, value))

/** "Ekpan · Uvwie LGA, Delta" — the label search results and pickers show. */
export function placeLabel(location) {
  const lga = location.localGovernmentArea
  if (location.localityType === 'LGA') return `${location.name} LGA, ${location.state} State`
  return `${location.name} · ${lga ? `${lga} LGA, ` : ''}${location.state || ''}`.replace(/, $/, '')
}

/** Location records for the LGA registry: names and sources only — no coordinates, pending, deliveries off. */
export function lgaRecords() {
  return STATES.flatMap((state) => LGA_REGISTRY[state].map((lga) => ({
    slug: `lga-${slug(state)}-${slug(lga)}`,
    name: lga,
    originalCandidateName: lga,
    alternativeNames: [],
    state,
    localGovernmentArea: lga,
    localityType: 'LGA',
    latitude: null,
    longitude: null,
    verificationStatus: 'pending',
    verificationMethod: 'DESK_RESEARCH',
    verificationSource: LGA_SOURCES[state].name,
    verificationSourceUrl: LGA_SOURCES[state].url,
    verificationCheckedAt: new Date(`${LGA_CHECKED_ON}T12:00:00Z`),
    verificationNotes: `Official LGA name listed in ${LGA_SOURCES[state].name}. Name only: no map pin or boundary has been checked.`,
    evidence: [{ kind: 'NAME_IN_USE', source: LGA_SOURCES[state].name, url: LGA_SOURCES[state].url, checkedAt: LGA_CHECKED_ON, method: 'DESK_RESEARCH', by: 'Claude (desk research for DOORSTEP)', note: 'Confirms the LGA name only; gives no coordinates.' }],
    boundaryVerificationStatus: 'none',
    isActive: true,
    deliveryEnabled: false,
  })))
}

/** Adds the LGA registry records that are missing. Never changes existing records (admin edits are kept). */
export async function seedLgaRegistry(db) {
  const records = lgaRecords()
  const existing = await db.location.findMany({ where: { slug: { in: records.map((record) => record.slug) } }, select: { slug: true } })
  const have = new Set(existing.map((row) => row.slug))
  const missing = records.filter((record) => !have.has(record.slug))
  if (missing.length) await db.location.createMany({ data: missing, skipDuplicates: true })
  // Hang existing places (e.g. the 36 Sapele candidates) under their LGA record, where they have no parent yet.
  const lgaRows = await db.location.findMany({ where: { localityType: 'LGA', slug: { startsWith: 'lga-' } }, select: { id: true, state: true, localGovernmentArea: true } })
  let linked = 0
  for (const row of lgaRows) {
    const result = await db.location.updateMany({ where: { parentId: null, state: row.state, localGovernmentArea: row.localGovernmentArea, NOT: [{ localityType: 'LGA' }, { id: row.id }] }, data: { parentId: row.id } })
    linked += result.count
  }
  return { lgas: records.length, created: missing.length, alreadyPresent: have.size, linkedToLga: linked }
}

/* ------------------------------------ CSV ------------------------------------- */
/** RFC 4180-style CSV parser (quotes, doubled quotes, commas and newlines inside quotes, CRLF, BOM). */
export function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  const source = String(text || '').replace(/^﻿/, '')
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { cell += '"'; i += 1 } else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"' && cell === '') quoted = true
    else if (char === ',') { row.push(cell); cell = '' }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += char
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((values) => values.some((value) => value.trim() !== ''))
}

export const IMPORT_COLUMNS = ['name', 'state', 'lga', 'type', 'parent', 'alternative_names', 'landmark', 'latitude', 'longitude', 'source', 'source_url', 'notes', 'status']
export const IMPORT_REQUIRED = ['name', 'state', 'lga', 'source']
export const IMPORT_STATUSES = ['pending', 'needs_review', 'needs_local_verification', 'incomplete']
export const MAX_IMPORT_ROWS = 5000
// Generous box around Delta, Edo and Rivers; pins outside it are almost certainly typing mistakes (e.g. swapped).
export const REGION_BOUNDS = { minLatitude: 4.1, maxLatitude: 7.8, minLongitude: 4.9, maxLongitude: 7.7 }
const inBounds = (latitude, longitude) => latitude >= REGION_BOUNDS.minLatitude && latitude <= REGION_BOUNDS.maxLatitude && longitude >= REGION_BOUNDS.minLongitude && longitude <= REGION_BOUNDS.maxLongitude
const HEADER_ALIASES = { lga: ['lga', 'localgovernmentarea', 'localgovernment'], alternative_names: ['alternativenames', 'othernames', 'aliases', 'alsoknownas'], source_url: ['sourceurl', 'url', 'link'], type: ['type', 'localitytype', 'kind'], latitude: ['latitude', 'lat'], longitude: ['longitude', 'lng', 'lon', 'long'], landmark: ['landmark', 'nearestlandmark'], parent: ['parent', 'parentname', 'community', 'town'] }

/** A template people can open in Excel, fill in and save as CSV. Its example rows are clearly marked as examples. */
export function importTemplate() {
  return [
    IMPORT_COLUMNS.join(','),
    'EXAMPLE — delete this row,Delta,Sapele,STREET,Okirigwe,,Near the market,,,Your source (e.g. rider field visit 2026-11-02),,Type has to be one of the types listed in the guide,pending',
  ].join('\r\n')
}

/** Key used for duplicate checks: the same name under the same parent in the same LGA of the same state. */
export const duplicateKey = ({ state, lga, parent, name }) => [normName(state), normName(lga), normName(parent), normName(name)].join('|')

/**
 * Checks an uploaded CSV against the rules and the existing directory. Nothing is saved here.
 * existing: [{ id, name, alternativeNames, state, localGovernmentArea, parentName, localityType }]
 * Returns { rows: [{ line, status: 'ok'|'duplicate'|'error', errors, warnings, record, duplicateOf }], summary, headerProblems }.
 */
export function checkImport(text, existing = []) {
  const table = parseCsv(text)
  if (!table.length) return { rows: [], summary: { total: 0, ok: 0, duplicates: 0, errors: 0 }, headerProblems: ['The file is empty.'] }
  const header = table[0].map((value) => normName(value))
  const columnOf = Object.fromEntries(IMPORT_COLUMNS.map((column) => [column, header.findIndex((value) => value === normName(column) || (HEADER_ALIASES[column] || []).includes(value))]))
  const headerProblems = IMPORT_REQUIRED.filter((column) => columnOf[column] < 0).map((column) => `Missing column "${column}".`)
  if (table.length - 1 > MAX_IMPORT_ROWS) headerProblems.push(`Too many rows (${table.length - 1}). Split the file into parts of ${MAX_IMPORT_ROWS} rows or fewer.`)
  if (headerProblems.length) return { rows: [], summary: { total: table.length - 1, ok: 0, duplicates: 0, errors: 0 }, headerProblems }

  // Existing names (and alternative names) per state + LGA + parent.
  const seen = new Map()
  for (const row of existing) for (const value of [row.name, ...(row.alternativeNames || [])]) {
    seen.set(duplicateKey({ state: row.state, lga: row.localGovernmentArea, parent: row.parentName, name: value }), { id: row.id, name: row.name, inFile: false })
  }
  const known = new Set(existing.map((row) => `${normName(row.state)}|${normName(row.localGovernmentArea)}|${normName(row.name)}`))

  const rows = table.slice(1).map((values, index) => {
    const get = (column) => (columnOf[column] >= 0 ? String(values[columnOf[column]] ?? '').trim() : '')
    const line = index + 2
    const errors = []
    const warnings = []
    const name = get('name').replace(/\s+/g, ' ')
    if (name.length < 2 || name.length > 80) errors.push('Name must be 2–80 characters.')
    if (/^example\b/i.test(name)) errors.push('This is the example row from the template — delete it.')
    const state = matchState(get('state'))
    if (!state) errors.push(`State "${get('state')}" isn't one DOORSTEP covers (use ${STATES.join(', ')}).`)
    const lga = state ? matchLga(state, get('lga')) : null
    if (state && !lga) errors.push(`"${get('lga')}" isn't an official LGA of ${state} State.`)
    const typeText = get('type').toUpperCase().replace(/\s+/g, '_')
    const localityType = typeText ? (LOCALITY_TYPES.includes(typeText) ? typeText : null) : 'UNKNOWN'
    if (!localityType) errors.push(`Type "${get('type')}" must be one of: ${LOCALITY_TYPES.filter((type) => type !== 'LGA').join(', ')}.`)
    if (localityType === 'LGA') errors.push('LGAs are already in the directory — import the places inside them.')
    const parent = get('parent').replace(/\s+/g, ' ')
    const latText = get('latitude')
    const lngText = get('longitude')
    let latitude = null
    let longitude = null
    if (latText || lngText) {
      latitude = Number(latText)
      longitude = Number(lngText)
      if (!latText || !lngText) errors.push('Give both latitude and longitude, or leave both empty.')
      else if (!validCoordinates(latitude, longitude)) errors.push('Latitude/longitude are not valid numbers.')
      else if (!inBounds(latitude, longitude)) errors.push(inBounds(longitude, latitude) ? 'Latitude and longitude look swapped.' : 'This pin is outside Delta, Edo and Rivers.')
    }
    const source = get('source')
    if (source.length < 3) errors.push('Say where this information came from (source).')
    const sourceUrl = get('source_url')
    if (sourceUrl && !/^https?:\/\/\S+$/i.test(sourceUrl)) errors.push('Source URL must start with http:// or https://.')
    const requested = get('status').toLowerCase().replace(/\s+/g, '_')
    let verificationStatus = latitude == null ? 'incomplete' : 'pending'
    if (requested === 'verified') warnings.push('Imported places are never marked verified. It will go to the review queue as "Needs review".')
    if (requested === 'verified') verificationStatus = 'needs_review'
    else if (requested && IMPORT_STATUSES.includes(requested)) verificationStatus = latitude == null && requested === 'pending' ? 'incomplete' : requested
    else if (requested) warnings.push(`Status "${get('status')}" isn't recognised — saved as "${verificationStatus}".`)
    if (latitude == null) warnings.push('No map pin: saved as Incomplete until someone pins it.')
    if (parent && lga && !known.has(`${normName(state)}|${normName(lga)}|${normName(parent)}`)) warnings.push(`Parent "${parent}" isn't in the directory for ${lga} yet — add it first (or earlier in this file) to link them.`)
    const alternativeNames = [...new Set(get('alternative_names').split(/[;|]/).map((value) => value.trim()).filter((value) => value && normName(value) !== normName(name)))].slice(0, 20)
    const record = errors.length ? null : { name, state, localGovernmentArea: lga, localityType, parentName: parent || null, alternativeNames, nearestLandmark: get('landmark').slice(0, 160) || null, latitude, longitude, source: source.slice(0, 200), sourceUrl: sourceUrl.slice(0, 500) || null, notes: get('notes').slice(0, 1000) || null, verificationStatus }

    let duplicateOf = null
    if (record) {
      for (const value of [name, ...alternativeNames]) {
        const hit = seen.get(duplicateKey({ state, lga, parent, name: value }))
        if (hit) { duplicateOf = hit; break }
      }
      if (!duplicateOf) {
        for (const value of [name, ...alternativeNames]) seen.set(duplicateKey({ state, lga, parent, name: value }), { id: null, name, inFile: true, line })
        known.add(`${normName(state)}|${normName(lga)}|${normName(name)}`)
      }
    }
    return { line, status: errors.length ? 'error' : duplicateOf ? 'duplicate' : 'ok', errors, warnings, record, duplicateOf }
  })
  return {
    rows,
    headerProblems: [],
    summary: { total: rows.length, ok: rows.filter((row) => row.status === 'ok').length, duplicates: rows.filter((row) => row.status === 'duplicate').length, errors: rows.filter((row) => row.status === 'error').length },
  }
}

/** Ranks directory matches for search/autocomplete: exact, then starts-with, then word-starts, then contains. */
export function rankMatches(rows, query, { limit = 20 } = {}) {
  const q = normName(query)
  if (!q) return []
  const score = (row) => {
    let best = 9
    for (const value of [row.name, ...(row.alternativeNames || [])]) {
      const key = normName(value)
      const words = String(value).toLowerCase().split(/[^a-z0-9]+/).map(normName)
      const s = key === q ? 0 : key.startsWith(q) ? 1 : words.some((word) => word.startsWith(q)) ? 2 : key.includes(q) ? 3 : 9
      best = Math.min(best, s + (value === row.name ? 0 : 0.5))
    }
    return best + (row.verificationStatus === 'verified' ? 0 : 0.2) + (row.localityType === 'LGA' ? 0.1 : 0)
  }
  return rows.map((row) => ({ row, s: score(row) })).filter((item) => item.s < 9).sort((a, b) => a.s - b.s || a.row.name.localeCompare(b.row.name)).slice(0, limit).map((item) => item.row)
}
