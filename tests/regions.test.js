import assert from 'node:assert/strict'
import test from 'node:test'
import { checkImport, duplicateKey, importTemplate, LGA_REGISTRY, lgaRecords, matchLga, matchState, parseCsv, placeLabel, rankMatches } from '../server/regions.js'
import { qualityFlags, VERIFICATION_STATUSES } from '../server/locations.js'

test('LGA registry: Delta 25, Edo 18, Rivers 23, names only, nothing verified or switched on', () => {
  assert.equal(LGA_REGISTRY.Delta.length, 25)
  assert.equal(LGA_REGISTRY.Edo.length, 18)
  assert.equal(LGA_REGISTRY.Rivers.length, 23)
  for (const list of Object.values(LGA_REGISTRY)) assert.equal(new Set(list).size, list.length)
  const records = lgaRecords()
  assert.equal(records.length, 66)
  assert.equal(new Set(records.map((record) => record.slug)).size, 66)
  for (const record of records) {
    assert.equal(record.latitude, null)
    assert.equal(record.longitude, null)
    assert.equal(record.verificationStatus, 'pending')
    assert.equal(record.deliveryEnabled, false)
    assert.ok(record.verificationSourceUrl.startsWith('https://'))
  }
})

test('state and LGA matching handles common spellings', () => {
  assert.equal(matchState('delta state'), 'Delta')
  assert.equal(matchState('Lagos'), null)
  assert.equal(matchLga('Rivers', 'Obio-Akpor'), 'Obio/Akpor')
  assert.equal(matchLga('Rivers', 'Port Harcourt City'), 'Port Harcourt')
  assert.equal(matchLga('Delta', 'warri south-west LGA'), 'Warri South West')
  assert.equal(matchLga('Edo', 'Sapele'), null)
  assert.equal(matchLga('Delta', 'Oredo'), null)
})

test('new statuses: incomplete exists; labels tell same-named places apart', () => {
  assert.ok(VERIFICATION_STATUSES.includes('incomplete'))
  assert.equal(placeLabel({ name: 'Ekpan', state: 'Delta', localGovernmentArea: 'Uvwie', localityType: 'COMMUNITY' }), 'Ekpan · Uvwie LGA, Delta')
  assert.equal(placeLabel({ name: 'Oredo', state: 'Edo', localGovernmentArea: 'Oredo', localityType: 'LGA' }), 'Oredo LGA, Edo State')
})

test('duplicate flags are scoped to state + LGA', () => {
  const rows = [
    { id: 'a', name: 'Ekpan', state: 'Delta', localGovernmentArea: 'Uvwie', verificationStatus: 'pending', verificationSource: 's' },
    { id: 'b', name: 'Ekpan', state: 'Delta', localGovernmentArea: 'Sapele', verificationStatus: 'pending', verificationSource: 's' },
    { id: 'c', name: 'EKPAN', state: 'Delta', localGovernmentArea: 'Sapele', verificationStatus: 'pending', verificationSource: 's' },
  ]
  const flags = qualityFlags(rows)
  assert.ok(!flags.a.includes('POSSIBLE_DUPLICATE'))
  assert.ok(flags.b.includes('POSSIBLE_DUPLICATE'))
  assert.ok(flags.c.includes('POSSIBLE_DUPLICATE'))
})

test('outside-area flag: pins in Delta, Edo or Rivers are fine; elsewhere is flagged', () => {
  const benin = { id: 'x', name: 'Ring Road', state: 'Edo', localGovernmentArea: 'Oredo', latitude: 6.335, longitude: 5.627, verificationStatus: 'pending', verificationSource: 's' }
  const lagos = { id: 'y', name: 'Ikeja', state: 'Delta', localGovernmentArea: 'Sapele', latitude: 6.6, longitude: 3.35, verificationStatus: 'pending', verificationSource: 's' }
  const flags = qualityFlags([benin, lagos])
  assert.ok(!flags.x.includes('OUTSIDE_SERVICE_AREA'))
  assert.ok(flags.y.includes('OUTSIDE_SERVICE_AREA'))
})

test('CSV parser handles quotes, commas, newlines, CRLF and BOM', () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n"multi\nline",z\n'), [['a', 'b'], ['x, y', 'say "hi"'], ['multi\nline', 'z']])
})

test('CSV import: validates rows, never imports as verified, flags duplicates in the same LGA only', () => {
  const csv = [
    'Name,State,LGA,Type,Parent,Alternative names,Landmark,Lat,Lng,Source,Source URL,Notes,Status',
    'Okirigwe Road,Delta,Sapele,STREET,,,,5.894,5.676,Rider field visit,,,verified',
    'Ekpan,Delta,Uvwie,COMMUNITY,,,,,,INEC polling unit list,https://example.org/pu,,',
    'Ekpan,Delta,Sapele,COMMUNITY,,,,,,INEC polling unit list,,,',
    'Ekpan,Delta,Uvwie,COMMUNITY,,,,,,Second copy,,,',
    'Nowhere,Lagos,Ikeja,TOWN,,,,,,x source,,,',
    'Swap,Rivers,Port Harcourt,TOWN,,,,7.0,4.8,src abc,,,',
    'Oredo,Edo,Sapele,TOWN,,,,,,src abc,,,',
    'Mile 2,Delta,Sapele,TOWN,,,,,,,,,',
    'Amukpe,Delta,Sapele,TOWN,,,,,,src abc,,,',
    'EXAMPLE — delete this row,Delta,Sapele,STREET,,,,,,src abc,,,',
  ].join('\n')
  const existing = [{ id: 'amukpe', name: 'Amukpe', alternativeNames: ['Amuokpe'], state: 'Delta', localGovernmentArea: 'Sapele', parentName: null }]
  const report = checkImport(csv, existing)
  const byLine = Object.fromEntries(report.rows.map((row) => [row.line, row]))
  assert.equal(byLine[2].status, 'ok')
  assert.equal(byLine[2].record.verificationStatus, 'needs_review')
  assert.ok(byLine[2].warnings.some((warning) => /never marked verified/.test(warning)))
  assert.equal(byLine[3].status, 'ok')
  assert.equal(byLine[3].record.verificationStatus, 'incomplete')
  assert.equal(byLine[4].status, 'ok', 'same name in a different LGA is not a duplicate')
  assert.equal(byLine[5].status, 'duplicate')
  assert.equal(byLine[5].duplicateOf.line, 3)
  assert.match(byLine[6].errors.join(' '), /isn't one DOORSTEP covers/)
  assert.match(byLine[7].errors.join(' '), /swapped/)
  assert.match(byLine[8].errors.join(' '), /official LGA of Edo/)
  assert.match(byLine[9].errors.join(' '), /source/)
  assert.equal(byLine[10].status, 'duplicate')
  assert.equal(byLine[10].duplicateOf.id, 'amukpe')
  assert.match(byLine[11].errors.join(' '), /example row/)
  assert.deepEqual(report.summary, { total: 10, ok: 3, duplicates: 2, errors: 5 })
  for (const row of report.rows) if (row.record) assert.notEqual(row.record.verificationStatus, 'verified')
})

test('CSV import: missing columns are reported before any row', () => {
  const report = checkImport('name,state\nA,Delta\n')
  assert.deepEqual(report.headerProblems, ['Missing column "lga".', 'Missing column "source".'])
  assert.equal(report.rows.length, 0)
  const template = checkImport(importTemplate())
  assert.equal(template.rows[0].status, 'error')
})

test('search ranking: exact, then starts-with, then contains; duplicates keys include the LGA', () => {
  const rows = [{ name: 'New Ekpan', alternativeNames: [] }, { name: 'Ekpan', alternativeNames: [] }, { name: 'Ekpanovic', alternativeNames: [] }, { name: 'Okirigwe', alternativeNames: ['Ekpa'] }]
  assert.deepEqual(rankMatches(rows, 'ekpan').map((row) => row.name), ['Ekpan', 'Ekpanovic', 'New Ekpan'])
  assert.notEqual(duplicateKey({ state: 'Delta', lga: 'Uvwie', name: 'Ekpan' }), duplicateKey({ state: 'Delta', lga: 'Sapele', name: 'Ekpan' }))
})
