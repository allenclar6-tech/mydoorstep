// Sapele LGA master directory (DOORSTEP working copy). Started from Sapele_LGA_Master_Directory_DOORSTEP.xlsx and
// expanded with streets, estates/layouts, quarters, villages and landmarks from public listings: INEC polling units
// (via eduweb.com.ng), zipcodes.ng, OpenStreetMap street index (openalfa), BEDC feeder areas in NERC orders,
// bookhotels.ng, finelib.com, the NHIA facility list, FRSC, Access Bank, infoisinfo.ng and local news. The full
// table with a source for every row is docs/data/Sapele_LGA_Master_Directory_DOORSTEP_expanded.xlsx.
// Not an official exhaustive register: anything under an "area to confirm" group (wards, "Sapele town",
// "Sapele LGA") is searchable but never used for delivery pricing until its district is confirmed.
// It holds no coordinates — areas are placed on the map by an admin (Admin › Delivery pricing).

export const SAPELE_DIRECTORY = [
  {"id": "ayomanor-road-district", "name": "Ayomanor Road district", "kind": "POSTCODE_DISTRICT", "postcode": "331211", "streets": ["Ayomanor Road", "Boyo Road", "Court Road", "Decima Road", "Dorenuma Road", "Hausa Road", "Hoddock/Haddock Road", "Itsekiri Road", "Kings Street", "Maduku/Maduka Road", "Nana Road", "Ofutoku Road", "Ogodo Road", "Otiobo Road", "Palmer Avenue", "Urhobo Road", "Water Road", "Yoruba Road", "Hausa Road Extension"], "landmarks": [["Ayomanor Primary School", "school"], ["UBA (Court Road)", "bank"], ["Union Bank (Yoruba Road)", "bank"], ["Boyo Road bank branch", "bank"]]},
  {"id": "chichester-road-district", "name": "Chichester Road district", "kind": "POSTCODE_DISTRICT", "postcode": "331212", "streets": ["Chichester Road", "Major Bowen Road", "Market Road", "Miller Road", "Sapele–Warri Road", "Bank Road", "Atufe Road"], "estates": ["Miller Estate"], "landmarks": [["First Bank (Chichester Road)", "bank"], ["Sapele Main Market", "market"]]},
  {"id": "atufe-road-district", "name": "Atufe Road district", "kind": "POSTCODE_DISTRICT", "postcode": "331221", "streets": ["Atufe Road", "Agoba Road", "Eta Lane", "Major Bowen Road", "Sapele–Warri Road", "Store Road"]},
  {"id": "agimele-village-district", "name": "Agimele Village district", "kind": "POSTCODE_DISTRICT", "postcode": "331222", "streets": ["Agimele", "Okirighwere/Okirigwre", "Shell Road", "Ugbeyiyi", "Shell Extension Road", "Ikhidero Crescent", "Mona School Road", "Omerie Ojigwor Avenue", "Tiko Drive"], "estates": ["Salubi Layout", "Sunny Layout", "NEPA Estate"], "landmarks": [["Orodje Grammar School (Shell Road)", "school"], ["Mona School", "school"], ["Shell Gate", "landmark"], ["Deeper Life (Shell Road)", "church"], ["Glorious Star Hospital (Salubi Layout)", "health"], ["TG Clinic (Tiko Drive)", "health"], ["West Side Hotel", "hotel"], ["Sunny Layout Hotel", "hotel"]]},
  {"id": "okpe-road-district", "name": "Okpe Road district", "kind": "POSTCODE_DISTRICT", "postcode": "331241", "streets": ["Okpe Road", "Adeniyi Road", "Adeola Road", "Agboghoroma Way", "Oghene Road", "Akintola Road", "Awolowo Road", "Crudas Road", "Lawrence Road", "Oleh Road", "Omene Street", "Oghene Rubber Factory Road"], "landmarks": [["Lawrence Junction", "junction"], ["Youth Centre (Awolowo Road)", "community"], ["Mega Driving School (126 Okpe Road)", "school"], ["UBA (Okpe Road)", "bank"]]},
  {"id": "ojolu-ghana-district", "name": "Ojolu/Ghana district", "kind": "POSTCODE_DISTRICT", "postcode": "331242", "streets": ["Agboghoroma Road", "Jakpor/Jakpo Road", "Odiete Street", "Ofuomanefe Road", "Amagiya Road", "Benin Road", "Dedevbo Road", "Egharevba Street", "Fonseca Road", "Gamioba Road", "Ghana Road"], "localities": ["Dedevbo"], "landmarks": [["Ojolu Road Junction", "junction"], ["Dedevbo Market", "market"]]},
  {"id": "reclamation-road-district", "name": "Reclamation Road district", "kind": "POSTCODE_DISTRICT", "postcode": "331261", "streets": ["Reclamation Road", "Christmas Road", "Commercial Avenue", "Macpherson Road", "Moreford/Morforoad Close", "Palmer Road", "Macpherson Road Extension"], "landmarks": [["Reclamation Park", "park"], ["Divine Care Clinic & Maternity (49 Macpherson Road)", "health"]]},
  {"id": "catholic-mission-road-district", "name": "Catholic Mission Road district", "kind": "POSTCODE_DISTRICT", "postcode": "331262", "streets": ["Catholic Mission Road", "Amitaye Road", "Etuwew Lane", "Ife Street", "Ikomi Road", "Negburagho/Negburago Road", "Ogbogbo Road", "Ogodo Road Extension", "Ogorode Road", "Neburagho Road"]},
  {"id": "sapele-town-postcode-area-to-confirm", "name": "Sapele town — postcode area to confirm", "kind": "UNASSIGNED", "postcode": null, "postcodeNote": "Verify locally", "displayName": "Sapele town", "streets": ["Abeke Road", "Abeke Junction", "Adeliyi Street", "Adidi Road", "Adidi Street", "Aganbi Avenue", "Agbowu Road", "Agwana Road", "Akpeki Crescent", "Akpolughe Street", "Alex Road", "Amitereh Street", "Amiteyekpa Lane", "Anudu Crescent", "Appah Way", "Azusa Street", "Banga Street", "Belefia Road", "Benin–Warri Road", "Burrow Pit Street", "Chief Lucky Ologhete Close", "Choice Close", "Chude Grammar School Road", "Chude Lane", "Deeper Life Close", "Ekpoto Street", "Elsa Way Road", "Esiri Road", "Fovie Lane", "Galloway Road", "Godfrey Idolor Road", "Green Egbedi Street", "Ife Road", "Ifie Road", "Ifoma Street", "Ikashegbe Street", "Izu Road", "Izu Street", "Kogoro Street", "Madaja Drive", "McIver Street", "Mona Way", "Mowoe Road", "NTC Road", "Obire Street", "Odudu Street", "Ofuma Road", "Ofurie Street", "Omotie Drive", "Omuvwie Road", "Onoraka Crescent", "Orieto Street", "OTC Road", "Otomewo Road", "Oviri Eko Road", "Pharmacist M. Okotie Street", "Renner Road", "Sabo Street", "Temile Close", "Tutu Way", "Unurhieri Street", "Zik Road", "Idjerhe Dickson Crescent", "Santorini Estates Road", "Otuedor Road", "Alegbe Road", "Orhorhor Road", "Agbeghe Avenue", "Hon Austin Ayemedejor Close", "Benjamin Oseregbaje Road", "Okirighwre-Benin Road"], "estates": ["Santorini Estates"], "landmarks": [["Gammon Bridge", "landmark"], ["Olympia", "landmark"], ["Water Side (Mission Road)", "landmark"], ["Sapele Ferry Terminal", "transport"], ["Central Hospital Sapele", "health"], ["Uriapele Shrine", "landmark"], ["Benin River waterfront", "landmark"], ["Sapele Athletics Club", "sport"], ["Access Bank (82 Sapele/Warri Road)", "bank"], ["Zenith Bank (Sapele/Warri Road)", "bank"], ["GTBank (Sapele-Warri Road, Ajogodo)", "bank"], ["Fidelity Bank (Sapele-Warri Road)", "bank"], ["Liberal Clinic & Diagnostic Centre (187 Sapele-Warri Road)", "health"], ["James Clinic & Maternity (259 Sapele/Warri Road)", "health"], ["Patoner Hospital (88/90 Sapele/Warri Road)", "health"], ["Fountain Hotel (17 Akpeki Crescent)", "hotel"]]},
  {"id": "sapele-town-urhiapele", "name": "Sapele town / Urhiapele", "kind": "NEIGHBOURHOOD", "postcode": null, "postcodeNote": "Confirm exact address", "localities": ["Urhiapele (traditional name associated with Sapele)"]},
  {"id": "new-road", "name": "New Road", "kind": "NEIGHBOURHOOD", "postcode": null, "postcodeNote": "Verify locally", "streets": ["New Road"]},
  {"id": "gra", "name": "GRA", "kind": "NEIGHBOURHOOD", "postcode": null, "postcodeNote": "Verify locally"},
  {"id": "reclamation", "name": "Reclamation", "kind": "NEIGHBOURHOOD", "postcode": "331261", "postcodeNote": "331261 (road district; confirm address)", "streets": ["Reclamation Road"]},
  {"id": "ogorode", "name": "Ogorode", "kind": "NEIGHBOURHOOD", "postcode": null, "postcodeNote": "Urban road: 331262; rural locality may be 331107", "streets": ["Ogorode Road", "New Ogorode Road", "Otite Road"], "localities": ["Ogorode community/quarter; boundaries need local confirmation", "Old Ogorode Village"], "landmarks": [["Otite Junction", "junction"], ["Nigerian Naval Engineering College (NNEC)", "school"], ["Sapele Clinic (181 New Ogorode Road)", "health"], ["Katsina Steel Rolling Guest House", "hotel"]]},
  {"id": "oton", "name": "Oton", "kind": "RURAL", "postcode": "331107", "postcodeNote": "331107 (rural listing; confirm exact address)", "localities": ["Oton"], "landmarks": [["Oton Primary School", "school"], ["Oton Community Townhall", "landmark"], ["Oton Road Junction", "junction"]]},
  {"id": "amuogodo", "name": "Amuogodo", "kind": "RURAL", "postcode": "331107", "localities": ["Amuogodo"]},
  {"id": "gana", "name": "Gana", "kind": "RURAL", "postcode": "331107", "streets": ["Gana Road", "Ezenwa Avenue"], "localities": ["Gana"], "landmarks": [["Gana Mixed Secondary School", "school"], ["Gana Basic Primary School", "school"], ["Gana Health Centre", "health"], ["Redience Hotel", "hotel"]]},
  {"id": "etamua-atamua", "name": "Etamua / Atamua", "kind": "RURAL", "postcode": "331107", "postcodeNote": "331107 (rural listing)", "localities": ["Etamua/Atamua"]},
  {"id": "abeke", "name": "Abeke", "kind": "NEIGHBOURHOOD", "postcode": null, "postcodeNote": "Verify locally", "streets": ["Abeke Road / Junction"], "landmarks": [["Abeke Primary School", "school"], ["Ufuoma Mixed Secondary School (9 Abeke Road)", "school"], ["Chinedu Dreams Hotel (14 Abeke Road)", "hotel"], ["Oraki Junction", "junction"]]},
  {"id": "ojolu-ghana", "name": "Ojolu/Ghana", "kind": "NEIGHBOURHOOD", "postcode": "331242", "streets": ["Agboghoroma Road; Jakpor/Jakpo Road; Odiete Street; Ofuomanefe Road"], "localities": ["Ojolu/Ghana quarter/locality"]},
  {"id": "ugberikoko", "name": "Ugberikoko", "kind": "NEIGHBOURHOOD", "postcode": null, "postcodeNote": "Verify locally", "streets": ["Ugberikoko Road", "Ugborikoko Road"], "landmarks": [["Runcorn Hotel", "hotel"]]},
  {"id": "ugbekoko", "name": "Ugbekoko", "kind": "NEIGHBOURHOOD", "postcode": null, "postcodeNote": "Verify locally", "localities": ["Ugbekoko"]},
  {"id": "ugwandja", "name": "Ugwandja", "kind": "NEIGHBOURHOOD", "postcode": null, "postcodeNote": "Verify locally", "localities": ["Ugwandja", "Ugwaja"]},
  {"id": "ufuoma", "name": "Ufuoma", "kind": "NEIGHBOURHOOD", "postcode": null, "postcodeNote": "Verify locally", "localities": ["Ufuoma"]},
  {"id": "hausa-quarters", "name": "Hausa Quarters", "kind": "NEIGHBOURHOOD", "postcode": null, "postcodeNote": "Hausa Road district listed as 331211; confirm address", "streets": ["Hausa Road"]},
  {"id": "commercial-avenue-area", "name": "Commercial Avenue area", "kind": "NEIGHBOURHOOD", "postcode": "331261", "streets": ["Commercial Avenue"]},
  {"id": "cemetery-road-area", "name": "Cemetery Road area", "kind": "NEIGHBOURHOOD", "postcode": null, "postcodeNote": "Verify locally", "streets": ["Cemetery Road"]},
  {"id": "mechanic-village", "name": "Mechanic Village", "kind": "NEIGHBOURHOOD", "postcode": null, "postcodeNote": "Verify locally", "landmarks": [["Industrial / Mechanic Village", "landmark"]]},
  {"id": "low-cost-housing-estate", "name": "Low Cost Housing Estate", "kind": "NEIGHBOURHOOD", "postcode": null, "postcodeNote": "Verify locally"},
  {"id": "onomor-quarters", "name": "Onomor Quarters", "kind": "NEIGHBOURHOOD", "postcode": null, "postcodeNote": "Verify locally", "localities": ["Onomor Quarters"]},
  {"id": "obire-quarters", "name": "Obire Quarters", "kind": "NEIGHBOURHOOD", "postcode": null, "postcodeNote": "Verify locally", "localities": ["Obire Quarters"]},
  {"id": "ekware-quarters", "name": "Ekware Quarters", "kind": "NEIGHBOURHOOD", "postcode": null, "postcodeNote": "Verify locally", "localities": ["Ekware Quarters"]},
  {"id": "uruaka-quarters", "name": "Uruaka Quarters", "kind": "NEIGHBOURHOOD", "postcode": null, "postcodeNote": "Verify locally", "localities": ["Uruaka Quarters"]},
  {"id": "agimele-village", "name": "Agimele Village", "kind": "NEIGHBOURHOOD", "postcode": "331222", "streets": ["Shell Road; Ugbeyiyi; Agimele"], "localities": ["Agimele"]},
  {"id": "sapele-rural-amukpe", "name": "Sapele Rural / Amukpe", "kind": "RURAL", "postcode": "331107", "streets": ["Comprehensive Road", "NDDC Road", "Ogaga Road", "Ikoyo Avenue", "Ogufere Road", "Obule School Road", "Old Eku Road", "Ajimile Road", "Old Sapele-Warri Road", "Ikwewu-Sapele Road"], "localities": ["Adegbarassa", "Ajakimonu", "Ajamikawa", "Amukpe", "Amuogodo", "Aruowon/Aronwon", "Atamua/Etamua", "Ebada", "Egbeku", "Egborode", "Emuaegbedi", "Gana", "Ikwewu", "Ogorode (rural locality)", "Okirigwre/Okirighwere", "Okuovwori", "Oton", "Sapele rural", "Ajogodo", "Eko Amukpe", "Ibada Amuokpe", "Ogegere Village", "Okwovwuri Village", "Adagbrassa", "Agbeku/Igbeku", "Adjekimoni", "Ugburumu", "Ibiwhor", "Okpobrisi", "Okuosajere", "Ajemile", "Ogorode-Amuokpe", "Ikwegwu", "Okirigbagha"], "estates": ["Max Vista Estate (Ikwewu)"], "landmarks": [["Amukpe Junction", "junction"], ["Econet Junction", "junction"], ["Ogaga Road Junction", "junction"], ["Amukpe Garage", "transport"], ["Okirigwre Garage", "transport"], ["Old Vitafoam", "landmark"], ["Amuokpe Hall", "landmark"], ["Igbeku Community Townhall", "landmark"], ["Ugburumu Community Hall", "landmark"], ["Ogegere Village Square", "landmark"], ["Okirigwe Police Station", "government"], ["St. Itas Girls’ Grammar School", "school"], ["St. Malachy Grammar School", "school"], ["Okpe Grammar School", "school"], ["Ethiope Primary School (Okirigwre)", "school"], ["Ogodo Primary School", "school"], ["Ovwore Primary School", "school"], ["Ogwere Primary School", "school"], ["Efeghren Primary School", "school"], ["Merit Mixed Secondary School", "school"], ["Obule Integrated Schools", "school"], ["Flourish Hotel (Comprehensive Road)", "hotel"], ["Jovad Hotel", "hotel"]]},
  {"id": "ugborhen", "name": "Ugborhen", "kind": "RURAL", "postcode": "331108", "streets": ["Obotie Road"], "localities": ["Ekeresan/Ikeresan", "Okopkooro/Okokporo (spelling requires confirmation)", "Okuodede", "Okuovu", "Ugbokurusu/Ugbukurusu", "Ugborhen", "Okuovo", "Okogborode", "Okpakomeje", "Ugborhewu", "Adaka", "Umuolu", "Ikeresan", "Obotie"], "landmarks": [["Okuovo Town Hall", "landmark"], ["Ugborhen Town Hall", "landmark"], ["Ozue Primary School", "school"], ["Okokporo Primary School", "school"], ["Ugborhen Primary School", "school"], ["Adaka Grammar School", "school"], ["Abasare Primary School", "school"], ["Ikeresan Primary School", "school"], ["Obotie Primary School", "school"]]},
  {"id": "elume", "name": "Elume", "kind": "RURAL", "postcode": "331109", "streets": ["Oyohe Loop"], "localities": ["Amuokpokpo", "Elume", "Igbimidaka/Ugbimidaka", "Inabome", "Jakpa", "Ogiedi", "Okuoke", "Olan", "Onoghro", "Oyohe", "Oyehen", "Ibada-Elume", "Ituru", "Ogirisen", "Deghele", "Iriabome", "Edegbrode", "Oku", "Oloho", "Otoramuan", "Ochemu", "Ogiede-Elume", "Okuoke-Elume", "Onyeke"], "landmarks": [["Elume Junction", "junction"], ["Men Townhall (Elume Junction)", "landmark"], ["Jakpa Town Hall", "landmark"], ["Okuoke Community Townhall", "landmark"], ["Ibada-Elume Community Townhall", "landmark"], ["Obada Primary School", "school"], ["Ofurhe Primary School", "school"], ["Ogiede Secondary School", "school"], ["Adagbrassa Primary School", "school"], ["Enwoe Primary School", "school"], ["Otoramuan Primary School", "school"], ["Ochemu Primary School", "school"], ["Egbele Primary School", "school"], ["Okuoke Primary School", "school"]]},
  {"id": "sapele-lga-to-verify", "name": "Sapele LGA — community affiliation to verify", "kind": "UNASSIGNED", "postcode": null, "postcodeNote": "Verify locally", "displayName": "Sapele LGA", "localities": ["Otonyasere/Oton Ya Sere", "Ero", "Omiugbo", "Erhera-Amua", "Abigbondo", "Okoho", "Okuo-Ajamata", "Otorakua", "Edegborode", "Iriabome/Riabome", "Okuo-Soja", "Igoyo", "Ibuwo", "Ajakolo", "Ajasolo", "Akuekpara", "Jatitor", "Jikwa", "Mele", "Ogegere", "Idale", "Ibada", "Ovbori", "Eko", "Okuo-Sajere", "Okokporo I", "Okokporo II", "Okegberode/Okegborade", "Okworu I", "Okworu II", "Okwodede I", "Okwodede II", "Okwadiokpara", "Oviri", "Okuoboregbe", "Okuaziza", "Ovuvukolo", "Abazara", "Ugbosien", "Ugbosien Island", "Ugbosien Waterside", "Okwewu", "Oghareki", "Agwa Stream", "Canal Creek", "Echon Stream", "Dako Rubber Factory", "Ukpe Sobo"]},
  {"id": "ward-sapele-urban-i", "name": "Sapele Urban I ward", "displayName": "Sapele Urban I ward", "kind": "UNASSIGNED", "postcode": null, "postcodeNote": "Verify locally", "streets": ["Mafuru Lane", "Izu Road", "Adagor Road", "Dafinone Way"], "localities": ["Odudu"], "landmarks": [["Sapele Township Stadium", "sport"], ["Sapele Local Government Secretariat", "government"], ["New Sapele Secretariat", "government"], ["Police Barracks", "government"], ["Police Clinic", "government"], ["Research Institute", "government"], ["Chude Grammar School", "school"], ["German Technical School", "school"], ["Omoge Enterprise", "landmark"], ["Fedison", "landmark"]]},
  {"id": "ward-sapele-urban-ii", "name": "Sapele Urban II ward", "displayName": "Sapele Urban II ward", "kind": "UNASSIGNED", "postcode": null, "postcodeNote": "Verify locally", "streets": ["Sanco Lane", "Ogaga Lane", "Omene Lane"], "localities": ["Akpobrisi"], "landmarks": [["Sharp Bending", "landmark"], ["Fire Brigade (Fire Service)", "government"], ["Omarin Primary School", "school"], ["LGA Nursery School", "school"], ["Bethel Baptist High School", "school"]]},
  {"id": "ward-sapele-urban-iii", "name": "Sapele Urban III ward", "displayName": "Sapele Urban III ward", "kind": "UNASSIGNED", "postcode": null, "postcodeNote": "Verify locally", "streets": ["Omokri Lane", "Igere Road", "Omene Road"], "localities": ["Agboghoroma (Aghoghoruma)"], "estates": ["Ogbodu Estate"], "landmarks": [["New Road Junction", "junction"], ["Nene Hospital", "health"], ["Ebenezer Church", "church"], ["Abbot Primary School", "school"], ["Kigho Store", "landmark"], ["E.J Eatery", "landmark"]]},
  {"id": "ward-sapele-urban-iv", "name": "Sapele Urban IV ward", "displayName": "Sapele Urban IV ward", "kind": "UNASSIGNED", "postcode": null, "postcodeNote": "Verify locally", "streets": ["Oriakhi Road", "Old Ministry Road", "Owumi Road"], "localities": ["Green Egbedi"], "landmarks": [["Anigboro Junction", "junction"], ["Benin Road Junction", "junction"], ["Okpe Hall", "landmark"], ["NSCDC Office", "government"], ["Uherevie Primary School", "school"], ["Palmer Primary School", "school"], ["Urhiapele Mixed Secondary School", "school"]]},
  {"id": "ward-sapele-urban-v", "name": "Sapele Urban V ward", "displayName": "Sapele Urban V ward", "kind": "UNASSIGNED", "postcode": null, "postcodeNote": "Verify locally", "streets": ["Laboard Road", "Green Egbedi Road", "Laboard Cutting"], "localities": ["Urhiapele Ameh", "Sowho Compound", "Ayomanor Compound"], "landmarks": [["Garden of Honour", "landmark"], ["White Inn", "hotel"], ["Apata Church", "church"], ["Urhiapele Primary School", "school"]]},
  {"id": "ward-sapele-urban-vi", "name": "Sapele Urban VI ward", "displayName": "Sapele Urban VI ward", "kind": "UNASSIGNED", "postcode": null, "postcodeNote": "Verify locally", "landmarks": [["Palmer Junction", "junction"], ["Okotie-Eboh Primary School", "school"], ["Zik Grammar School", "school"], ["Ethiope Primary School", "school"], ["Crowther Primary School", "school"], ["St. Luke Primary School", "school"]]},
  {"id": "ward-sapele-urban-vii", "name": "Sapele Urban VII ward", "displayName": "Sapele Urban VII ward", "kind": "UNASSIGNED", "postcode": null, "postcodeNote": "Verify locally", "streets": ["Ekanone Road", "Uko Road", "Ebbah Street", "Overah Road", "Isidje (Esidje) Street", "Mission Road (Gana side)", "Abigborodo Road", "Aworun-Abigborodo Road"], "localities": ["Orahkpa", "Ariwon", "Urhuakpa Quarters"], "landmarks": [["Uncle Young", "landmark"], ["Celestial Church (Celestial Parish)", "church"], ["Ufuoma Primary School", "school"], ["Wesley Primary School (Ariwon)", "school"], ["Aroko Primary School (Ariwon)", "school"]]},
  {"id": "ward-sapele-urban-viii", "name": "Sapele Urban VIII ward", "displayName": "Sapele Urban VIII ward", "kind": "UNASSIGNED", "postcode": null, "postcodeNote": "Verify locally", "localities": ["Ogbogbo", "Ajajiewor"], "landmarks": [["Premier Cinema", "landmark"], ["Nigerian Navy Base", "government"], ["Omatsola Primary School", "school"], ["Aiyetan Primary School", "school"], ["Okotie-Eboh Grammar School", "school"], ["Association Primary School", "school"], ["NEPA Staff School", "school"]]},
  {"id": "ward-amuokpe", "name": "Amuokpe ward", "displayName": "Amuokpe ward", "kind": "UNASSIGNED", "postcode": null, "postcodeNote": "Verify locally", "landmarks": [["NYSC Zonal Secretariat", "government"], ["Former Police Barracks", "government"], ["S.T.C Sapele", "government"], ["Abella Flower", "landmark"], ["K’s Events", "landmark"], ["Chief Warri Compound", "landmark"], ["Igbewor’s Compound", "landmark"]]},
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
  ...(area.estates || []).map((name) => ({ type: 'estate', name, area })),
  ...(area.landmarks || []).map(([name, kind]) => ({ type: 'landmark', kind, name, area })),
])// Search keys: each spelling, plus the full name so bracketed details ("NNEC", "Okpe Road") are searchable too.
.map((entry) => ({ ...entry, keys: [...new Set([...spellings(entry.name), entry.name].map(norm).filter(Boolean))] }))

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
    kind: entry.kind || null,
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
  // Each hit remembers how much of the address it actually matched, so "UBA (Okpe Road)" beats a bare "UBA".
  const hits = DIRECTORY_ENTRIES.filter((entry) => isPlannableArea(entry.area))
    .map((entry) => ({ ...entry, matched: Math.max(0, ...entry.keys.filter((key) => key.length >= 3 && haystack.includes(` ${key} `)).map((key) => key.length)) }))
    .filter((entry) => entry.matched > 0)
  if (hits.length) {
    const areaHit = hits.filter((entry) => entry.type === 'area').sort((a, b) => b.matched - a.matched)[0]
    if (areaHit) return areaHit.area
    const longest = Math.max(...hits.map((entry) => entry.matched))
    const best = hits.filter((entry) => entry.matched === longest)
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
