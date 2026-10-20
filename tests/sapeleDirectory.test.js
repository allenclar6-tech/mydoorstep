import assert from 'node:assert/strict'
import { test } from 'node:test'
import { areaForAddress, directoryAddressLine, directoryZoneSeeds, SAPELE_DIRECTORY, searchDirectory, spellings } from '../server/sapeleDirectory.js'

test('the imported directory keeps every area with a unique id', () => {
  assert.equal(SAPELE_DIRECTORY.length, 38)
  assert.equal(new Set(SAPELE_DIRECTORY.map((area) => area.id)).size, 38)
  assert.equal(SAPELE_DIRECTORY.find((area) => area.id === 'ayomanor-road-district').postcode, '331211')
  assert.ok(SAPELE_DIRECTORY.find((area) => area.id === 'ayomanor-road-district').streets.includes('Boyo Road'))
})

test('search finds streets by either spelling, and districts by postcode', () => {
  assert.equal(searchDirectory('boyo')[0].areaName, 'Ayomanor Road district')
  assert.equal(searchDirectory('haddock')[0].name, 'Hoddock/Haddock Road')
  assert.equal(searchDirectory('331262')[0].name, 'Catholic Mission Road district')
  assert.deepEqual(spellings('Okirighwere/Okirigwre'), ['Okirighwere', 'Okirigwre'])
  assert.equal(searchDirectory('x').length, 0)
})

test('addresses map to a district only when it is unambiguous', () => {
  assert.equal(areaForAddress('12 Boyo Road, Sapele').id, 'ayomanor-road-district')
  assert.equal(areaForAddress('Major Bowen Road, Sapele'), null, 'listed under two districts')
  assert.equal(areaForAddress('Major Bowen Road, Atufe Road district').id, 'atufe-road-district')
  assert.equal(areaForAddress('Ogodo Road Extension').id, 'catholic-mission-road-district')
  assert.equal(areaForAddress('Plot 4, Sapele 331262').id, 'catholic-mission-road-district')
  assert.equal(areaForAddress('somewhere unknown'), null)
})

test('pricing areas exclude the "verify locally" catch-all groups and the address line reads naturally', () => {
  const seeds = directoryZoneSeeds()
  assert.equal(seeds.length, 36)
  assert.ok(!seeds.some((seed) => seed.id.startsWith('sapele-town-postcode') || seed.id === 'sapele-lga-to-verify'))
  assert.equal(directoryAddressLine(searchDirectory('boyo')[0]), 'Boyo Road, Ayomanor Road district, Sapele 331211')
})
