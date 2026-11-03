import assert from 'node:assert/strict'
import { test } from 'node:test'
import { COVERED_STATES, ensureCoverage, isCoveredPoint, stateForCity, stateForPoint } from '../server/coverage.js'
import { deliverability } from '../server/customerApp.js'

// DOORSTEP operates in Nigeria, in Delta, Edo and Rivers States only.
const at = (latitude, longitude) => ({ latitude, longitude })

test('towns in Delta, Edo and Rivers are covered; neighbouring states are not', () => {
  const inside = { Sapele: at(5.8916, 5.6846), Warri: at(5.5167, 5.75), Asaba: at(6.2, 6.733), Agbor: at(6.25, 6.2), 'Benin City': at(6.335, 5.6037), Auchi: at(7.067, 6.267), Ekpoma: at(6.743, 6.14), 'Port Harcourt': at(4.8156, 7.0498), Bonny: at(4.45, 7.17), Bori: at(4.67, 7.36), Omoku: at(5.34, 6.66) }
  const expected = { Sapele: 'Delta State', Warri: 'Delta State', Asaba: 'Delta State', Agbor: 'Delta State', 'Benin City': 'Edo State', Auchi: 'Edo State', Ekpoma: 'Edo State', 'Port Harcourt': 'Rivers State', Bonny: 'Rivers State', Bori: 'Rivers State', Omoku: 'Rivers State' }
  for (const [town, point] of Object.entries(inside)) assert.ok(stateForPoint(point), `${town} is covered`)
  for (const town of Object.keys(inside)) assert.equal(stateForPoint(inside[town]), expected[town], town)
  for (const [town, point] of Object.entries({ Okada: at(6.73, 5.39), Igueben: at(6.6, 6.24), Uromi: at(6.7, 6.33) })) assert.equal(stateForPoint(point), 'Edo State', town)
  for (const [town, point] of Object.entries({ Koko: at(6.0, 5.47), 'Ogwashi-Uku': at(6.18, 6.52), Kwale: at(5.71, 6.43) })) assert.equal(stateForPoint(point), 'Delta State', town)
  const outside = { Lagos: at(6.5244, 3.3792), Abuja: at(9.0765, 7.3986), Onitsha: at(6.1498, 6.7857), Owerri: at(5.4836, 7.0333), Aba: at(5.1066, 7.3667), Akure: at(7.2571, 5.2058), Yenagoa: at(4.9247, 6.2676), Enugu: at(6.4584, 7.5464) }
  for (const [town, point] of Object.entries(outside)) assert.equal(isCoveredPoint(point), false, `${town} is outside`)
  assert.equal(isCoveredPoint(null), false)
})

test('every covered town maps to its state, and deliveries outside the states are refused', () => {
  assert.deepEqual(COVERED_STATES.map((state) => state.name), ['Delta State', 'Edo State', 'Rivers State'])
  assert.equal(stateForCity('port harcourt'), 'Rivers State')
  assert.equal(stateForCity('Lagos'), null)
  const lagos = deliverability({ point: at(6.5244, 3.3792) }, { pricing: {}, zones: [] })
  assert.equal(lagos.deliverable, false)
  assert.match(lagos.message, /Delta, Edo and Rivers/)
  assert.equal(deliverability({ point: at(6.335, 5.6037) }, { pricing: {}, zones: [] }).deliverable, true, 'Benin City is no longer "too far from Sapele"')
})

test('service towns are added once, and an admin-disabled town is never switched back on', async () => {
  const rows = { country: [], state: [], city: [], serviceArea: [] }
  const upsert = (table, match) => async ({ create }) => { const found = rows[table].find((row) => match(row, create)); if (found) return found; const row = { id: `${table}${rows[table].length}`, ...create }; rows[table].push(row); return row }
  const db = {
    country: { upsert: upsert('country', (row, create) => row.code === create.code) },
    state: { upsert: upsert('state', (row, create) => row.name === create.name) },
    city: { upsert: upsert('city', (row, create) => row.stateId === create.stateId && row.name === create.name) },
    serviceArea: {
      findUnique: async ({ where }) => rows.serviceArea.find((row) => row.cityId === where.countryId_stateId_cityId.cityId) || null,
      create: async ({ data }) => { rows.serviceArea.push(data); return data },
    },
  }
  const towns = COVERED_STATES.reduce((sum, state) => sum + state.cities.length, 0)
  assert.equal((await ensureCoverage(db)).added, towns)
  rows.serviceArea[0].enabled = false
  assert.equal((await ensureCoverage(db)).added, 0, 'second run adds nothing')
  assert.equal(rows.serviceArea[0].enabled, false, 'left switched off')
})
