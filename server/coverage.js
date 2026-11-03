// Where DOORSTEP operates: Nigeria, in Delta, Edo and Rivers States only. Shared by the server and the website
// (no Node-only imports), so the sign-up town picker, map limits and order checks always agree.

export const COUNTRY = { code: 'NG', name: 'Nigeria' }

/** Covered states and their main towns. Add a town here and it becomes a live service area on the next deploy. */
export const COVERED_STATES = [
  { name: 'Delta State', short: 'Delta', cities: ['Sapele', 'Warri', 'Effurun', 'Asaba', 'Ughelli', 'Agbor', 'Abraka', 'Oghara', 'Kwale', 'Ozoro', 'Oleh', 'Burutu', 'Koko', 'Ogwashi-Uku', 'Issele-Uku'] },
  { name: 'Edo State', short: 'Edo', cities: ['Benin City', 'Ekpoma', 'Auchi', 'Uromi', 'Irrua', 'Igarra', 'Okada', 'Ubiaja', 'Igueben', 'Afuze', 'Sabongida-Ora'] },
  { name: 'Rivers State', short: 'Rivers', cities: ['Port Harcourt', 'Obio-Akpor', 'Oyigbo', 'Eleme', 'Okrika', 'Bonny', 'Omoku', 'Ahoada', 'Bori', 'Degema', 'Isiokpo', 'Elele'] },
]
export const COVERAGE_LABEL = 'Delta, Edo and Rivers States'

/**
 * Each state as a few rectangles that follow its shape, so neighbouring cities (Onitsha, Owerri, Aba, Akure,
 * Yenagoa) fall outside. Approximate at the edges; the exact delivery area is still decided by distance from the
 * store and the admin's delivery pricing.
 */
export const STATE_BOUNDS = {
  // Checked in this order, so Rivers' north-west (Omoku) isn't taken for Delta.
  'Rivers State': [{ south: 4.2, north: 5.42, west: 6.35, east: 7.2 }, { south: 4.4, north: 4.85, west: 7.2, east: 7.62 }],
  // Benin City and the Esan towns, then northern Edo (Auchi, Igarra) — west edge kept clear of Akure and Owo.
  'Edo State': [{ south: 6.05, north: 6.4, west: 5.0, east: 6.05 }, { south: 6.4, north: 6.8, west: 5.0, east: 6.75 }, { south: 6.8, north: 7.6, west: 5.6, east: 6.75 }],
  // Warri, Sapele, Ughelli and the riverine south, then Agbor, Ogwashi-Uku and Asaba (east edge stops short of Onitsha).
  'Delta State': [{ south: 5.0, north: 6.05, west: 5.0, east: 6.76 }, { south: 6.05, north: 6.4, west: 6.05, east: 6.76 }],
}
/** One box around all three states, for map search and address suggestions. */
export const COVERAGE_BOUNDS = { south: 4.2, north: 7.65, west: 5.0, east: 7.65 }
/** [longitude, latitude] for map views and search "near me" when nothing better is known (between Warri, Sapele and Benin). */
export const COVERAGE_CENTER = [5.85, 5.95]

/** Which covered state a point is in, or null when it's outside Delta, Edo and Rivers. */
export function stateForPoint(point) {
  const latitude = Number(point?.latitude)
  const longitude = Number(point?.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  const inside = (box) => latitude >= box.south && latitude <= box.north && longitude >= box.west && longitude <= box.east
  return Object.entries(STATE_BOUNDS).find(([, boxes]) => boxes.some(inside))?.[0] || null
}
export const isCoveredPoint = (point) => Boolean(stateForPoint(point))

/** The covered state a town belongs to (case-insensitive), or null. */
export function stateForCity(cityName) {
  const wanted = String(cityName || '').trim().toLowerCase()
  return COVERED_STATES.find((state) => state.cities.some((city) => city.toLowerCase() === wanted))?.name || null
}

/**
 * Makes sure every covered town exists as a service area (new ones start enabled). Safe to run on every start: it
 * only adds what's missing. It never removes or renames anything, and never re-enables a town an admin switched off.
 */
export async function ensureCoverage(db) {
  const country = await db.country.upsert({ where: { code: COUNTRY.code }, update: {}, create: COUNTRY })
  let added = 0
  for (const covered of COVERED_STATES) {
    const state = await db.state.upsert({ where: { countryId_name: { countryId: country.id, name: covered.name } }, update: {}, create: { countryId: country.id, name: covered.name } })
    for (const name of covered.cities) {
      const city = await db.city.upsert({ where: { stateId_name: { stateId: state.id, name } }, update: {}, create: { stateId: state.id, name } })
      const key = { countryId_stateId_cityId: { countryId: country.id, stateId: state.id, cityId: city.id } }
      const existing = await db.serviceArea.findUnique({ where: key, select: { id: true } })
      if (!existing) { await db.serviceArea.create({ data: { countryId: country.id, stateId: state.id, cityId: city.id, enabled: true, currency: 'NGN', timezone: 'Africa/Lagos' } }); added += 1 }
    }
  }
  return { added }
}
