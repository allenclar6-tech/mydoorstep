// Sapele LGA master directory (DOORSTEP working copy, imported from Sapele_LGA_Master_Directory_DOORSTEP.xlsx).
// Areas, streets, traditional quarters/villages and postcodes for address search and delivery-area planning.
// Not an official exhaustive street register: spellings, boundaries and postcodes marked "verify" must be
// confirmed locally. It holds no coordinates — areas are placed on the map by an admin (Admin › Delivery pricing).
// Sources (postcodes): NigeriaPostcode.com, NigeriaPostal.com and TEEZAB Sapele listings.

export const SAPELE_DIRECTORY = [
  {"id": "ayomanor-road-district", "name": "Ayomanor Road district", "kind": "POSTCODE_DISTRICT", "postcode": "331211", "streets": ["Ayomanor Road", "Boyo Road", "Court Road", "Decima Road", "Dorenuma Road", "Hausa Road", "Hoddock/Haddock Road", "Itsekiri Road", "Kings Street", "Maduku/Maduka Road", "Nana Road", "Ofutoku Road", "Ogodo Road", "Otiobo Road", "Palmer Avenue", "Urhobo Road", "Water Road", "Yoruba Road"]},
  {"id": "chichester-road-district", "name": "Chichester Road district", "kind": "POSTCODE_DISTRICT", "postcode": "331212", "streets": ["Chichester Road", "Major Bowen Road", "Market Road", "Miller Road", "Sapele–Warri Road"]},
  {"id": "atufe-road-district", "name": "Atufe Road district", "kind": "POSTCODE_DISTRICT", "postcode": "331221", "streets": ["Atufe Road", "Agoba Road", "Eta Lane", "Major Bowen Road", "Sapele–Warri Road", "Store Road"]},
  {"id": "agimele-village-district", "name": "Agimele Village district", "kind": "POSTCODE_DISTRICT", "postcode": "331222", "streets": ["Agimele", "Okirighwere/Okirigwre", "Shell Road", "Ugbeyiyi"]},
  {"id": "okpe-road-district", "name": "Okpe Road district", "kind": "POSTCODE_DISTRICT", "postcode": "331241", "streets": ["Okpe Road", "Adeniyi Road", "Adeola Road", "Agboghoroma Way", "Oghene Road"]},
  {"id": "ojolu-ghana-district", "name": "Ojolu/Ghana district", "kind": "POSTCODE_DISTRICT", "postcode": "331242", "streets": ["Agboghoroma Road", "Jakpor/Jakpo Road", "Odiete Street", "Ofuomanefe Road"]},
  {"id": "reclamation-road-district", "name": "Reclamation Road district", "kind": "POSTCODE_DISTRICT", "postcode": "331261", "streets": ["Reclamation Road", "Christmas Road", "Commercial Avenue", "Macpherson Road", "Moreford/Morforoad Close", "Palmer Road"]},
  {"id": "catholic-mission-road-district", "name": "Catholic Mission Road district", "kind": "POSTCODE_DISTRICT", "postcode": "331262", "streets": ["Catholic Mission Road", "Amitaye Road", "Etuwew Lane", "Ife Street", "Ikomi Road", "Negburagho/Negburago Road", "Ogbogbo Road", "Ogodo Road Extension", "Ogorode Road"]},
  {"id": "sapele-town-postcode-area-to-confirm", "name": "Sapele town — postcode area to confirm", "kind": "UNASSIGNED", "postcode": null, "postcodeNote": "Verify locally", "displayName": "Sapele town", "streets": ["Abeke Road", "Abeke Junction", "Adeliyi Street", "Adidi Road", "Adidi Street", "Aganbi Avenue", "Agbowu Road", "Agwana Road", "Akintola Road", "Akpeki Crescent", "Akpolughe Street", "Alex Road", "Amitereh Street", "Amiteyekpa Lane", "Anudu Crescent", "Appah Way", "Awolowo Road", "Azusa Street", "Banga Street", "Belefia Road", "Benin–Warri Road", "Burrow Pit Street", "Cemetery Road", "Chief Lucky Ologhete Close", "Choice Close", "Chude Grammar School Road", "Chude Lane", "Crudas Road", "Deeper Life Close", "Egharevba Street", "Ekpoto Street", "Elsa Way Road", "Esiri Road", "Fonseca Road", "Fovie Lane", "Galloway Road", "Gamioba Road", "Godfrey Idolor Road", "Green Egbedi Street", "Ife Road", "Ifie Road", "Ifoma Street", "Ikashegbe Street", "Ikomi Road", "Ikoyo Avenue", "Izu Road", "Izu Street", "Kogoro Street", "Lawrence Road", "Madaja Drive", "Major Bowen Road", "McIver Street", "Mona Way", "Mowoe Road", "New Ogorode Road", "NTC Road", "Obire Street", "Odudu Street", "Ofuma Road", "Ofurie Street", "Omene Street", "Omotie Drive", "Omuvwie Road", "Onoraka Crescent", "Orieto Street", "OTC Road", "Otite Road", "Otomewo Road", "Oviri Eko Road", "Pharmacist M. Okotie Street", "Renner Road", "Sabo Street", "Shell Road", "Temile Close", "Tutu Way", "Ugberikoko Road", "Unurhieri Street", "Zik Road"]},
  {"id": "sapele-town-urhiapele", "name": "Sapele town / Urhiapele", "kind": "NEIGHBOURHOOD", "postcode": null, "postcodeNote": "Confirm exact address", "localities": ["Urhiapele (traditional name associated with Sapele)"]},
  {"id": "new-road", "name": "New Road", "kind": "NEIGHBOURHOOD", "postcode": null, "postcodeNote": "Verify locally", "streets": ["New Road"]},
  {"id": "gra", "name": "GRA", "kind": "NEIGHBOURHOOD", "postcode": null, "postcodeNote": "Verify locally"},
  {"id": "reclamation", "name": "Reclamation", "kind": "NEIGHBOURHOOD", "postcode": "331261", "postcodeNote": "331261 (road district; confirm address)", "streets": ["Reclamation Road"]},
  {"id": "ogorode", "name": "Ogorode", "kind": "NEIGHBOURHOOD", "postcode": null, "postcodeNote": "Urban road: 331262; rural locality may be 331107", "streets": ["Ogorode Road"], "localities": ["Ogorode community/quarter; boundaries need local confirmation"]},
  {"id": "oton", "name": "Oton", "kind": "RURAL", "postcode": "331107", "postcodeNote": "331107 (rural listing; confirm exact address)", "localities": ["Oton"]},
  {"id": "amuogodo", "name": "Amuogodo", "kind": "RURAL", "postcode": "331107", "localities": ["Amuogodo"]},
  {"id": "gana", "name": "Gana", "kind": "RURAL", "postcode": "331107", "localities": ["Gana"]},
  {"id": "etamua-atamua", "name": "Etamua / Atamua", "kind": "RURAL", "postcode": "331107", "postcodeNote": "331107 (rural listing)", "localities": ["Etamua/Atamua"]},
  {"id": "abeke", "name": "Abeke", "kind": "NEIGHBOURHOOD", "postcode": null, "postcodeNote": "Verify locally", "streets": ["Abeke Road / Junction"]},
  {"id": "ojolu-ghana", "name": "Ojolu/Ghana", "kind": "NEIGHBOURHOOD", "postcode": "331242", "streets": ["Agboghoroma Road; Jakpor/Jakpo Road; Odiete Street; Ofuomanefe Road"], "localities": ["Ojolu/Ghana quarter/locality"]},
  {"id": "ugberikoko", "name": "Ugberikoko", "kind": "NEIGHBOURHOOD", "postcode": null, "postcodeNote": "Verify locally", "streets": ["Ugberikoko Road"]},
  {"id": "ugbekoko", "name": "Ugbekoko", "kind": "NEIGHBOURHOOD", "postcode": null, "postcodeNote": "Verify locally", "localities": ["Ugbekoko"]},
  {"id": "ugwandja", "name": "Ugwandja", "kind": "NEIGHBOURHOOD", "postcode": null, "postcodeNote": "Verify locally", "localities": ["Ugwandja"]},
  {"id": "ufuoma", "name": "Ufuoma", "kind": "NEIGHBOURHOOD", "postcode": null, "postcodeNote": "Verify locally", "localities": ["Ufuoma"]},
  {"id": "hausa-quarters", "name": "Hausa Quarters", "kind": "NEIGHBOURHOOD", "postcode": null, "postcodeNote": "Hausa Road district listed as 331211; confirm address", "streets": ["Hausa Road"]},
  {"id": "commercial-avenue-area", "name": "Commercial Avenue area", "kind": "NEIGHBOURHOOD", "postcode": "331261", "streets": ["Commercial Avenue"]},
  {"id": "cemetery-road-area", "name": "Cemetery Road area", "kind": "NEIGHBOURHOOD", "postcode": null, "postcodeNote": "Verify locally", "streets": ["Cemetery Road"]},
  {"id": "mechanic-village", "name": "Mechanic Village", "kind": "NEIGHBOURHOOD", "postcode": null, "postcodeNote": "Verify locally"},
  {"id": "low-cost-housing-estate", "name": "Low Cost Housing Estate", "kind": "NEIGHBOURHOOD", "postcode": null, "postcodeNote": "Verify locally"},
  {"id": "onomor-quarters", "name": "Onomor Quarters", "kind": "NEIGHBOURHOOD", "postcode": null, "postcodeNote": "Verify locally", "localities": ["Onomor Quarters"]},
  {"id": "obire-quarters", "name": "Obire Quarters", "kind": "NEIGHBOURHOOD", "postcode": null, "postcodeNote": "Verify locally", "localities": ["Obire Quarters"]},
  {"id": "ekware-quarters", "name": "Ekware Quarters", "kind": "NEIGHBOURHOOD", "postcode": null, "postcodeNote": "Verify locally", "localities": ["Ekware Quarters"]},
  {"id": "uruaka-quarters", "name": "Uruaka Quarters", "kind": "NEIGHBOURHOOD", "postcode": null, "postcodeNote": "Verify locally", "localities": ["Uruaka Quarters"]},
  {"id": "agimele-village", "name": "Agimele Village", "kind": "NEIGHBOURHOOD", "postcode": "331222", "streets": ["Shell Road; Ugbeyiyi; Agimele"], "localities": ["Agimele"]},
  {"id": "sapele-rural-amukpe", "name": "Sapele Rural / Amukpe", "kind": "RURAL", "postcode": "331107", "localities": ["Adegbarassa", "Ajakimonu", "Ajamikawa", "Amukpe", "Amuogodo", "Aruowon/Aronwon", "Atamua/Etamua", "Ebada", "Egbeku", "Egborode", "Emuaegbedi", "Gana", "Ikwewu", "Ogorode (rural locality)", "Okirigwre/Okirighwere", "Okuovwori", "Oton", "Sapele rural"]},
  {"id": "ugborhen", "name": "Ugborhen", "kind": "RURAL", "postcode": "331108", "localities": ["Ekeresan/Ikeresan", "Okopkooro/Okokporo (spelling requires confirmation)", "Okuodede", "Okuovu", "Ugbokurusu/Ugbukurusu", "Ugborhen"]},
  {"id": "elume", "name": "Elume", "kind": "RURAL", "postcode": "331109", "localities": ["Amuokpokpo", "Elume", "Igbimidaka/Ugbimidaka", "Inabome", "Jakpa", "Ogiedi", "Okuoke", "Olan", "Onoghro", "Oyohe"]},
  {"id": "sapele-lga-to-verify", "name": "Sapele LGA — community affiliation to verify", "kind": "UNASSIGNED", "postcode": null, "postcodeNote": "Verify locally", "displayName": "Sapele LGA", "localities": ["Otonyasere/Oton Ya Sere", "Ero", "Omiugbo", "Ugbeyiyi", "Erhera-Amua", "Agimele", "Abigbondo", "Okoho", "Okuo-Ajamata", "Otorakua", "Edegborode", "Deghele", "Iriabome/Riabome", "Okuo-Soja", "Oyohe", "Ituru", "Igoyo", "Ibuwo", "Ajakolo", "Ajasolo", "Akuekpara", "Jatitor", "Jikwa", "Mele", "Ogegere", "Idale", "Ibada", "Ovbori", "Eko", "Okuo-Sajere", "Okokporo I", "Okokporo II", "Okegberode/Okegborade", "Okworu I", "Okworu II", "Okwodede I", "Okwodede II", "Okwadiokpara", "Oviri", "Obotie", "Okuoboregbe", "Okuaziza", "Ovuvukolo", "Abazara", "Ugbosien", "Ugbosien Island", "Ugbosien Waterside", "Okwewu", "Oku", "Oghareki", "Ogirisen", "Agwa Stream", "Canal Creek", "Echon Stream", "Dako Rubber Factory", "Ukpe Sobo"]},
]

const norm = (value) => String(value || '').toLowerCase().normalize('NFKD').replace(/[–—]/g, '-').replace(/[^a-z0-9]+/g, ' ').trim()
// "Hoddock/Haddock Road" → ["Hoddock Road", "Haddock Road"]; "Okirighwere/Okirigwre" → both spellings.
export function spellings(name) {
  const text = String(name).replace(/\s*\(.*?\)\s*/g, ' ').trim()
  const slash = text.match(/^(.*?)(\S+)\/(\S+)(.*)$/)
  if (!slash) return [text]
  const [, before, first, second, after] = slash
  return [...new Set([`${before}${first}${after}`, `${before}${second}${after}`].map((entry) => entry.replace(/\s+/g, ' ').trim()))]
}

export const areaLabel = (area) => area.displayName || area.name
export const isPlannableArea = (area) => area.kind !== 'UNASSIGNED'

/** Every searchable name: areas, streets and quarters/villages, each pointing at its area. */
export const DIRECTORY_ENTRIES = SAPELE_DIRECTORY.flatMap((area) => [
  ...(isPlannableArea(area) ? [{ type: 'area', name: area.name, area }] : []),
  ...(area.streets || []).map((name) => ({ type: 'street', name, area })),
  ...(area.localities || []).map((name) => ({ type: 'place', name, area })),
]).map((entry) => ({ ...entry, keys: spellings(entry.name).map(norm).filter(Boolean) }))

/** Typeahead over the directory: "boyo" → Boyo Road · Ayomanor Road district · 331211. */
export function searchDirectory(query, limit = 8) {
  const raw = norm(query)
  const q = /^\d{6}$/.test(raw) ? raw : raw.replace(/^(no |plot |house )?\d+[a-z]?\s+/, '')
  if (q.length < 2) return []
  const postcode = /^\d{6}$/.test(q) ? q : null
  const scored = []
  for (const entry of DIRECTORY_ENTRIES) {
    let score = 0
    if (postcode) score = entry.area.postcode === postcode ? (entry.type === 'area' ? 3 : 1) : 0
    else for (const key of entry.keys) {
      if (key === q) score = Math.max(score, 5)
      else if (key.startsWith(q)) score = Math.max(score, 4)
      else if (key.split(' ').some((word) => word.startsWith(q))) score = Math.max(score, 3)
      else if (key.includes(q)) score = Math.max(score, 2)
    }
    if (score) scored.push({ score: score + (entry.type === 'area' ? 0.5 : 0) + (entry.area.kind === 'UNASSIGNED' ? -0.5 : 0), entry })
  }
  const seen = new Set()
  return scored.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name)).map(({ entry }) => ({
    type: entry.type,
    name: entry.name,
    areaId: entry.area.id,
    areaName: areaLabel(entry.area),
    postcode: entry.area.postcode,
    postcodeToConfirm: !entry.area.postcode || Boolean(entry.area.postcodeNote),
  })).filter((result) => { const key = `${norm(result.name)}:${result.areaId}`; if (seen.has(key)) return false; seen.add(key); return true }).slice(0, limit)
}

/** Formats a picked result as an address line: "Boyo Road, Ayomanor Road district, Sapele 331211". */
export function directoryAddressLine(result, typed = '') {
  const house = result.type === 'street' ? String(typed).trim().match(/^((?:no\.?|plot|house)\s*)?\d+[a-z]?\b/i)?.[0] : null
  const parts = result.type === 'area' ? [result.areaName] : [`${house ? `${house} ` : ''}${result.name}`, result.areaName]
  return `${parts.join(', ')}, Sapele${result.postcode ? ` ${result.postcode}` : ''}`
}

/**
 * The directory area a typed address belongs to, used for delivery-area pricing when the customer has no map pin.
 * Longest matching street/place/area wins; a street listed under two districts only counts if one of the district
 * names (or a unique postcode) also appears. Catch-all "verify" groups are never returned.
 */
export function areaForAddress(text) {
  const haystack = ` ${norm(text)} `
  if (haystack.trim().length < 3) return null
  const hits = DIRECTORY_ENTRIES.filter((entry) => isPlannableArea(entry.area) && entry.keys.some((key) => key.length >= 3 && haystack.includes(` ${key} `)))
  if (hits.length) {
    const areaHit = hits.filter((entry) => entry.type === 'area').sort((a, b) => b.name.length - a.name.length)[0]
    if (areaHit) return areaHit.area
    const longest = Math.max(...hits.map((entry) => Math.max(...entry.keys.map((key) => key.length))))
    const best = hits.filter((entry) => Math.max(...entry.keys.map((key) => key.length)) === longest)
    const areas = [...new Set(best.map((entry) => entry.area))]
    if (areas.length === 1) return areas[0]
  }
  const code = haystack.match(/\b(3\d{5})\b/)?.[1]
  if (code) {
    const withCode = SAPELE_DIRECTORY.filter((area) => isPlannableArea(area) && area.postcode === code && !area.postcodeNote)
    const district = withCode.find((area) => area.kind === 'POSTCODE_DISTRICT' || area.kind === 'RURAL')
    if (district) return district
  }
  return null
}

/** Delivery-pricing areas seeded from the directory (no coordinates: an admin places each one). */
export function directoryZoneSeeds() {
  return SAPELE_DIRECTORY.filter(isPlannableArea).map((area) => ({ id: area.id, name: area.name, radiusMeters: area.kind === 'RURAL' ? 2500 : area.kind === 'POSTCODE_DISTRICT' ? 1200 : 700 }))
}
