import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Bike, Calculator, Check, CloudRain, Handshake, Map as MapIcon, MapPin, Plus, Route, Save, Scale, Store, Trash2, X } from 'lucide-react'
import { apiBase } from '../config/apiBase'
import { MapPointPicker } from '../map/MapPointPicker'
import { distanceTable, isPoint, priceDelivery, slug, starterZones } from '../../server/deliveryPricing.js'
import { SAPELE_DIRECTORY } from '../../server/sapeleDirectory.js'

const DIRECTORY_BY_ID = new Map(SAPELE_DIRECTORY.map((area) => [area.id, area]))

// Admin › Delivery pricing. One screen to balance what customers pay for delivery, what riders earn, and what
// DOORSTEP keeps — with a Glovo-style calculator that measures real Sapele routes.

const token = () => { try { return localStorage.getItem('doorstep-admin-token') } catch { return null } }
async function call(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${apiBase}${path}`, { method, headers: { Authorization: `Bearer ${token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Something went wrong. Try again.')
  return data
}
const money = (minor) => minor == null ? '—' : `${minor < 0 ? '−' : ''}₦${(Math.abs(minor) / 100).toLocaleString('en-NG', { maximumFractionDigits: 0 })}`
const toMinor = (value) => value === '' || value == null ? null : Math.round(Number(value) * 100)
const toNaira = (minor) => minor == null ? '' : String(minor / 100)

const SOURCE_LABEL = { ROAD: 'By road', ROAD_CAPPED: 'Detour capped', ESTIMATE: 'Estimated', ASSUMED: 'Assumed', TABLE: 'Table' }
const TABS = [['calculator', 'Calculator', Calculator], ['rates', 'Fees & rider rates', Scale], ['areas', 'Sapele areas', MapPin], ['agreed', 'Agreed prices', Handshake]]

function NairaField({ label, minor, onChange, allowEmpty = false, hint }) {
  return <label className="dp-field"><span>{label}</span><div className="dp-naira"><i>₦</i><input type="number" inputMode="decimal" min="0" step="10" value={toNaira(minor)} placeholder={allowEmpty ? 'Use formula' : '0'} onChange={(event) => onChange(event.target.value === '' && allowEmpty ? null : toMinor(event.target.value || 0))} /></div>{hint && <small>{hint}</small>}</label>
}
function NumberField({ label, value, onChange, step = '0.1', suffix, hint }) {
  return <label className="dp-field"><span>{label}</span><div className={suffix ? 'dp-naira has-unit' : 'dp-naira'}>{suffix && <i>{suffix}</i>}<input type="number" inputMode="decimal" min="0" step={step} value={value} onChange={(event) => onChange(Number(event.target.value || 0))} /></div>{hint && <small>{hint}</small>}</label>
}
function Toggle({ checked, onChange, label }) {
  return <label className="dp-toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span aria-hidden="true" /><b>{label}</b></label>
}

/** Full-screen map for setting the calculator's two pins or placing one Sapele area. */
function MapSheet({ mode, value, onDone, onClose }) {
  const targets = mode === 'route'
    ? [{ key: 'pickup', label: 'From (store)', shortLabel: 'pickup', badge: 'A', markerClass: 'is-pickup' }, { key: 'dropoff', label: 'To (customer)', shortLabel: 'destination', badge: 'B', markerClass: 'is-dropoff' }]
    : [{ key: 'area', label: 'Area centre', shortLabel: 'area centre', badge: '', markerClass: 'is-dropoff' }]
  const [points, setPoints] = useState(value || {})
  const ready = targets.every((target) => points[target.key])
  return <div className="dp-map-sheet" role="dialog" aria-modal="true">
    <div className="location-map-card delivery-map-experience map-picker-host">
      <MapPointPicker targets={targets} value={points} onChange={setPoints} onClose={onClose} routeMode={mode === 'route' ? 'between' : 'none'} savedPlaces={false}
        heading={mode === 'route' ? { kicker: 'DELIVERY CALCULATOR', title: 'Set the two ends of the trip', intro: 'A is the store, B is the customer. Search, tap the map or drag a pin.' } : { kicker: 'SAPELE AREA', title: `Place ${value?.name || 'this area'}`, intro: 'Put the pin in the middle of the area. Customers who pick this area are priced from here.' }}>
        <div className="map-picker-actions"><button type="button" className="primary-button map-picker-confirm" disabled={!ready} onClick={() => onDone(points)}>{mode === 'route' ? 'Use these points' : 'Save area pin'}</button></div>
      </MapPointPicker>
    </div>
  </div>
}

function Breakdown({ quote, warningText }) {
  const c = quote.customer
  const r = quote.rider
  const lines = [
    ['Base fee', c.fromRule ? null : c.baseMinor],
    [`Distance (${quote.km} km)`, c.fromRule ? null : c.distanceMinor],
    ['Minimum / maximum adjustment', c.clampAdjustMinor || null],
    ['Agreed route price', c.fromRule ? c.ruleFeeMinor : null],
    ['Area surcharge', c.zoneSurchargeMinor || null],
    ['Busy-time boost', c.boostMinor || null],
    ['Margin protection top-up', c.marginTopUpMinor || null],
    ['Rounding', c.roundingMinor || null],
  ].filter(([, value]) => value != null)
  const riderLines = r.paidBy === 'BUSINESS' ? [] : [
    ['Agreed route amount', r.fromRule ? r.payMinor - r.boostMinor : null],
    ['Distance rate', r.bandMinor],
    ['Area bonus', r.zoneBonusMinor || null],
    ['Busy-time boost', r.boostMinor || null],
  ].filter(([, value]) => value != null)
  const margin = quote.deliveryMarginMinor
  return <div className="dp-receipt">
    <div className="dp-receipt-head">
      <span className={`dp-chip is-${(quote.distance.source || '').toLowerCase()}`}><Route size={14} aria-hidden="true" />{quote.km} km · {SOURCE_LABEL[quote.distance.source] || quote.distance.source}</span>
      {quote.distance.straightMeters != null && <small>Straight line {(quote.distance.straightMeters / 1000).toFixed(1)} km{quote.distance.roadMeters != null ? ` · road route ${(quote.distance.roadMeters / 1000).toFixed(1)} km` : ''}</small>}
      {(quote.pickupZone || quote.dropoffZone) && <small>{quote.pickupZone?.name || 'Unmapped area'} → {quote.dropoffZone?.name || 'Unmapped area'}{quote.rule ? ` · agreed price${quote.rule.agreedWith ? ` with ${quote.rule.agreedWith}` : ''}` : ''}</small>}
    </div>
    <dl className="dp-lines">
      <div className="is-strong"><dt>Delivery fee charged</dt><dd>{money(c.deliveryFeeMinor)}</dd></div>
      {lines.map(([label, value]) => <div className="is-sub" key={label}><dt>{label}</dt><dd>{value > 0 ? '+' : ''}{money(value)}</dd></div>)}
      <div className="is-strong"><dt>{r.paidBy === 'BUSINESS' ? 'Rider (business’s own)' : 'Rider and delivery cost'}</dt><dd>{r.paidBy === 'BUSINESS' ? 'Paid by business' : money(r.payMinor)}</dd></div>
      {riderLines.map(([label, value]) => <div className="is-sub" key={`r-${label}`}><dt>{label}</dt><dd>{money(value)}</dd></div>)}
      {r.paidBy !== 'BUSINESS' && <div className={margin == null ? '' : margin < 0 ? 'is-bad' : 'is-good'}><dt>Delivery margin</dt><dd>{money(margin)}</dd></div>}
      <div><dt>Commission ({quote.commission.percent}% of food)</dt><dd>{money(quote.commission.minor)}</dd></div>
      <div><dt>Service fee</dt><dd>{money(quote.serviceFeeMinor)}</dd></div>
      <div className="is-total"><dt>Customer pays</dt><dd>{money(quote.customerTotalMinor)}</dd></div>
      <div className="is-revenue"><dt>DOORSTEP revenue per order</dt><dd>{money(quote.doorstepRevenueMinor)}</dd></div>
    </dl>
    {quote.warnings.length > 0 && <ul className="dp-warnings">{quote.warnings.map((code) => <li key={code}><AlertTriangle size={15} aria-hidden="true" />{warningText[code] || code}</li>)}</ul>}
    <p className="dp-footnote">Revenue excludes payment processing, support, promotions, refunds, taxes and other operating expenses. A negative delivery margin reduces total revenue.</p>
  </div>
}

function BalanceTable({ rows }) {
  const max = Math.max(1, ...rows.map((row) => Math.max(row.deliveryFeeMinor || 0, row.riderPayMinor || 0)))
  return <div className="dp-table" role="table" aria-label="Fee, rider pay and margin by distance">
    <div className="dp-row is-head" role="row"><span role="columnheader">Km</span><span role="columnheader">Customer fee</span><span role="columnheader">Rider</span><span role="columnheader">Margin</span></div>
    {rows.map((row) => <div className="dp-row" role="row" key={row.km}>
      <span role="cell"><b>{row.km}</b></span>
      <span role="cell">{money(row.deliveryFeeMinor)}{row.marginTopUpMinor > 0 && <i className="dp-topup" title="Raised by margin protection">↑</i>}</span>
      <span role="cell">{money(row.riderPayMinor)}</span>
      <span role="cell" className={row.deliveryMarginMinor == null ? '' : row.deliveryMarginMinor < 0 ? 'is-bad' : 'is-good'}>{money(row.deliveryMarginMinor)}</span>
      <span className="dp-bars" aria-hidden="true"><i style={{ width: `${(row.deliveryFeeMinor / max) * 100}%` }} /><i className="is-rider" style={{ width: `${((row.riderPayMinor || 0) / max) * 100}%` }} /></span>
    </div>)}
  </div>
}

function EndPicker({ label, value, onChange, businesses, zones, allowBusiness }) {
  const kind = value && 'restaurantId' in value ? 'business' : value && 'zoneId' in value ? 'area' : 'pin'
  return <fieldset className="dp-end"><legend>{label}</legend>
    <div className="dp-seg" role="radiogroup">
      {allowBusiness && <button type="button" role="radio" aria-checked={kind === 'business'} className={kind === 'business' ? 'is-on' : ''} onClick={() => onChange({ restaurantId: businesses.find((entry) => entry.pinned)?.id || '' })}><Store size={14} />Business</button>}
      <button type="button" role="radio" aria-checked={kind === 'area'} className={kind === 'area' ? 'is-on' : ''} onClick={() => onChange({ zoneId: zones.find(isPoint)?.id || zones[0]?.id || '' })}><MapPin size={14} />Area</button>
      <button type="button" role="radio" aria-checked={kind === 'pin'} className={kind === 'pin' ? 'is-on' : ''} onClick={() => onChange({})}><MapIcon size={14} />Map pin</button>
    </div>
    {kind === 'business' && <select value={value.restaurantId} onChange={(event) => onChange({ restaurantId: event.target.value })}>{businesses.map((entry) => <option key={entry.id} value={entry.id} disabled={!entry.pinned}>{entry.name}{entry.pinned ? '' : ' (no map pin)'}</option>)}</select>}
    {kind === 'area' && <select value={value.zoneId} onChange={(event) => onChange({ zoneId: event.target.value })}>{zones.filter((zone) => zone.active).map((zone) => <option key={zone.id} value={zone.id} disabled={!isPoint(zone)}>{zone.name}{isPoint(zone) ? '' : ' (not placed yet)'}</option>)}</select>}
    {kind === 'pin' && <p className="dp-pin">{isPoint(value) ? `${value.label || 'Pin'} · ${Number(value.latitude).toFixed(5)}, ${Number(value.longitude).toFixed(5)}` : 'Use “Set pins on map” below.'}</p>}
  </fieldset>
}

export function DeliveryPricingAdmin() {
  const [loaded, setLoaded] = useState(null)
  const [pricing, setPricing] = useState(null)
  const [riderPay, setRiderPay] = useState(null)
  const [tab, setTab] = useState('calculator')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [mapSheet, setMapSheet] = useState(null)
  const [calc, setCalc] = useState({ pickup: {}, dropoff: {}, subtotal: 8000, fulfilment: 'AUTO' })
  const [measured, setMeasured] = useState(null)
  const [calcState, setCalcState] = useState({ busy: false, error: '' })

  const load = useCallback(async () => {
    try {
      const data = await call('/api/admin/delivery-pricing')
      setLoaded(data); setPricing(structuredClone(data.pricing)); setRiderPay(structuredClone(data.finance.riderPay))
      setCalc((current) => ({ ...current, pickup: current.pickup.restaurantId || current.pickup.zoneId || isPoint(current.pickup) ? current.pickup : data.businesses.find((entry) => entry.pinned) ? { restaurantId: data.businesses.find((entry) => entry.pinned).id } : {} }))
    } catch (loadError) { setError(loadError.message) }
  }, [])
  useEffect(() => { load() }, [load])

  const dirty = loaded && pricing && (JSON.stringify(pricing) !== JSON.stringify(loaded.pricing) || JSON.stringify(riderPay) !== JSON.stringify(loaded.finance.riderPay))
  const finance = useMemo(() => loaded && riderPay ? { commission: loaded.finance.commission, riderPay: { ...riderPay, bands: [...riderPay.bands].filter((band) => band.upToKm > 0).sort((a, b) => a.upToKm - b.upToKm) } } : null, [loaded, riderPay])
  const subtotalMinor = Math.max(0, Math.round(Number(calc.subtotal || 0) * 100))
  const fulfilmentFor = (fallback) => calc.fulfilment === 'AUTO' ? fallback : calc.fulfilment
  // Re-price the last measured trip instantly as settings are edited, so the effect of every change is visible.
  const livePrice = useMemo(() => {
    if (!measured || !pricing || !finance) return null
    const zone = (id) => pricing.zones.find((entry) => entry.id === id) || null
    try { return priceDelivery({ distance: measured.quote.distance, pickupZone: zone(measured.quote.pickupZone?.id), dropoffZone: zone(measured.quote.dropoffZone?.id), subtotalMinor, fulfilment: fulfilmentFor(measured.quote.fulfilment), pricing, finance }) } catch { return null }
  }, [measured, pricing, finance, subtotalMinor, calc.fulfilment])
  const table = useMemo(() => pricing && finance ? distanceTable({ pricing, finance, subtotalMinor, fulfilment: fulfilmentFor('DOORSTEP_RIDER'), maxKm: Math.min(15, Math.ceil(pricing.distance.maxDeliveryKm)) }) : [], [pricing, finance, subtotalMinor, calc.fulfilment])

  if (error && !loaded) return <section className="dp"><div className="dp-card dp-alert"><AlertTriangle size={18} />{error}</div></section>
  if (!loaded || !pricing || !riderPay) return <section className="dp"><div className="dp-card">Loading delivery pricing…</div></section>

  const setP = (path, value) => setPricing((current) => { const next = structuredClone(current); let target = next; for (const part of path.slice(0, -1)) target = target[part]; target[path.at(-1)] = value; return next })
  const placedCount = pricing.zones.filter(isPoint).length
  const unpinned = loaded.businesses.filter((entry) => !entry.pinned)
  const negativeRows = table.filter((row) => row.deliveryMarginMinor != null && row.deliveryMarginMinor < 0).length

  const calculate = async () => {
    setCalcState({ busy: true, error: '' })
    try {
      const body = { pickup: calc.pickup, dropoff: calc.dropoff, subtotalMinor, ...(calc.fulfilment !== 'AUTO' ? { fulfilment: calc.fulfilment } : {}), draft: { pricing, riderPay: finance.riderPay } }
      const data = await call('/api/admin/delivery-pricing/calculate', { method: 'POST', body })
      setMeasured(data); setCalcState({ busy: false, error: '' })
    } catch (calcError) { setCalcState({ busy: false, error: calcError.message }) }
  }

  const save = async (publish = pricing.published) => {
    setSaving(true); setMessage(''); setError('')
    try {
      const data = await call('/api/admin/delivery-pricing', { method: 'PUT', body: { pricing: { ...pricing, published: publish }, riderPay: finance.riderPay } })
      setLoaded((current) => ({ ...current, pricing: data.pricing, finance: data.finance }))
      setPricing(structuredClone(data.pricing)); setRiderPay(structuredClone(data.finance.riderPay))
      setMessage(publish && !loaded.pricing.published ? 'Published. Checkout now prices delivery by distance.' : !publish && loaded.pricing.published ? 'Unpublished. Checkout is back on the flat ₦800 fee.' : 'Saved.')
    } catch (saveError) { setError(saveError.message) } finally { setSaving(false) }
  }

  const addRule = () => {
    const placedZones = pricing.zones.filter((zone) => zone.active)
    if (placedZones.length < 2) return setError('Add at least two areas first.')
    setP(['routeRules'], [...pricing.routeRules, { id: `rule-${Date.now().toString(36)}`, fromZoneId: placedZones[0].id, toZoneId: placedZones[1].id, bothWays: true, customerFeeMinor: null, riderPayMinor: null, agreedWith: '', note: '', active: true }])
  }
  const addZone = (name) => {
    const clean = name.trim()
    if (clean.length < 2) return
    let id = slug(clean); let n = 2
    while (pricing.zones.some((zone) => zone.id === id)) id = `${slug(clean).slice(0, 36)}-${n++}`
    setP(['zones'], [...pricing.zones, { id, name: clean, latitude: null, longitude: null, radiusMeters: 800, customerSurchargeMinor: 0, riderBonusMinor: 0, active: true }])
  }

  return <section className="dp">
    <header className="dp-hero">
      <div><span className="dp-kicker">SAPELE DELIVERY PRICING</span><h1>Balance fees, rider pay and your margin</h1>
        <p>{pricing.published ? 'Live: checkout charges by road distance.' : 'Not live yet: checkout still uses the flat ₦800 fee. Set your rates, test trips, then publish.'}</p></div>
      <span className={pricing.published ? 'dp-live is-on' : 'dp-live'}>{pricing.published ? <><Check size={14} />Live</> : 'Draft'}</span>
    </header>

    {!loaded.routingConfigured && <div className="dp-card dp-alert"><AlertTriangle size={18} /><span>Road routing isn’t configured on the server yet (add the Mapbox server token on Render). Until it is, distances are estimated from the straight line × {pricing.distance.detourFactor}.</span></div>}
    {negativeRows > 0 && <div className="dp-card dp-alert"><AlertTriangle size={18} /><span>{negativeRows} distance{negativeRows > 1 ? 's' : ''} in the table lose money on delivery. Turn on margin protection or adjust the rates.</span></div>}

    <nav className="dp-tabs" aria-label="Delivery pricing sections">{TABS.map(([key, label, Icon]) => <button type="button" key={key} className={tab === key ? 'is-on' : ''} aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}><Icon size={15} aria-hidden="true" />{label}</button>)}</nav>

    {tab === 'calculator' && <>
      <div className="dp-card">
        <h2><Calculator size={18} aria-hidden="true" />Trip calculator</h2>
        <div className="dp-ends">
          <EndPicker label="From" value={calc.pickup} onChange={(pickup) => setCalc({ ...calc, pickup })} businesses={loaded.businesses} zones={pricing.zones} allowBusiness />
          <EndPicker label="To" value={calc.dropoff} onChange={(dropoff) => setCalc({ ...calc, dropoff })} businesses={loaded.businesses} zones={pricing.zones} />
        </div>
        <button type="button" className="dp-link" onClick={() => setMapSheet({ mode: 'route' })}><MapIcon size={15} aria-hidden="true" />Set pins on map</button>
        <div className="dp-grid">
          <label className="dp-field"><span>Food subtotal</span><div className="dp-naira"><i>₦</i><input type="number" inputMode="decimal" min="0" step="100" value={calc.subtotal} onChange={(event) => setCalc({ ...calc, subtotal: event.target.value })} /></div></label>
          <label className="dp-field"><span>Who delivers</span><select value={calc.fulfilment} onChange={(event) => setCalc({ ...calc, fulfilment: event.target.value })}><option value="AUTO">As the business has chosen</option><option value="DOORSTEP_RIDER">DOORSTEP rider (15%)</option><option value="BUSINESS_RIDER">Business’s own rider (10%)</option></select></label>
        </div>
        {calcState.error && <p className="dp-error" role="alert">{calcState.error}</p>}
        <button type="button" className="dp-primary" disabled={calcState.busy} onClick={calculate}>{calcState.busy ? 'Measuring route…' : 'Calculate'}</button>
      </div>
      {livePrice && <div className="dp-card"><h2><Bike size={18} aria-hidden="true" />{measured.pickup.label} → {measured.dropoff.label}</h2>{dirty && <p className="dp-muted">Showing your unsaved changes.</p>}<Breakdown quote={livePrice} warningText={loaded.warningText} /></div>}
      <div className="dp-card"><h2><Scale size={18} aria-hidden="true" />Balance check by distance</h2><p className="dp-muted">Every whole kilometre with your current settings{subtotalMinor ? ` and a ${money(subtotalMinor)} order` : ''}. Green margins are what DOORSTEP keeps from delivery; red loses money.</p><BalanceTable rows={table} /></div>
    </>}

    {tab === 'rates' && <>
      <div className="dp-card"><h2>What customers pay for delivery</h2>
        <div className="dp-grid">
          <NairaField label="Base fee" minor={pricing.customerFee.baseMinor} onChange={(v) => setP(['customerFee', 'baseMinor'], v)} />
          <NumberField label="Km included in base" value={pricing.customerFee.includedKm} suffix="km" onChange={(v) => setP(['customerFee', 'includedKm'], v)} />
          <NairaField label="Each extra km" minor={pricing.customerFee.perKmMinor} onChange={(v) => setP(['customerFee', 'perKmMinor'], v)} />
          <NairaField label="Minimum fee" minor={pricing.customerFee.minimumMinor} onChange={(v) => setP(['customerFee', 'minimumMinor'], v)} />
          <NairaField label="Maximum fee" minor={pricing.customerFee.maximumMinor} onChange={(v) => setP(['customerFee', 'maximumMinor'], v)} />
          <NairaField label="Round up to" minor={pricing.customerFee.roundToMinor} onChange={(v) => setP(['customerFee', 'roundToMinor'], v)} hint="₦50 keeps prices tidy" />
        </div>
        <h3>Service fee</h3>
        <div className="dp-grid">
          <NumberField label="Percent of food" value={pricing.serviceFee.percent} suffix="%" step="0.5" onChange={(v) => setP(['serviceFee', 'percent'], v)} />
          <NairaField label="Minimum" minor={pricing.serviceFee.minimumMinor} onChange={(v) => setP(['serviceFee', 'minimumMinor'], v)} />
          <NairaField label="Maximum" minor={pricing.serviceFee.maximumMinor} onChange={(v) => setP(['serviceFee', 'maximumMinor'], v)} />
        </div>
      </div>

      <div className="dp-card"><h2><Bike size={18} aria-hidden="true" />What riders earn</h2>
        <p className="dp-muted">Sapele has no official rider tariff, so this is DOORSTEP’s own rate card. A delivery earns the first band its road distance fits in. Agreed prices on specific routes override it.</p>
        <Toggle checked={riderPay.enabled} onChange={(v) => setRiderPay({ ...riderPay, enabled: v })} label="Pay riders from this rate card" />
        <div className="dp-bands">
          {riderPay.bands.map((band, index) => <div className="dp-band" key={index}>
            <NumberField label="Up to" value={band.upToKm} suffix="km" step="0.5" onChange={(v) => setRiderPay({ ...riderPay, bands: riderPay.bands.map((entry, i) => i === index ? { ...entry, upToKm: v } : entry) })} />
            <NairaField label="Rider earns" minor={band.amountMinor} onChange={(v) => setRiderPay({ ...riderPay, bands: riderPay.bands.map((entry, i) => i === index ? { ...entry, amountMinor: v ?? 0 } : entry) })} />
            <button type="button" className="dp-icon" aria-label={`Remove band up to ${band.upToKm} km`} onClick={() => setRiderPay({ ...riderPay, bands: riderPay.bands.filter((_, i) => i !== index) })}><Trash2 size={16} /></button>
          </div>)}
          <div className="dp-row-actions">
            <button type="button" className="dp-link" onClick={() => setRiderPay({ ...riderPay, bands: [...riderPay.bands, { upToKm: (riderPay.bands.at(-1)?.upToKm || 0) + 2, amountMinor: riderPay.bands.at(-1)?.amountMinor || 50_000 }] })}><Plus size={15} />Add band</button>
            {riderPay.bands.length === 0 && <button type="button" className="dp-link" onClick={() => setRiderPay({ ...riderPay, bands: loaded.starterRiderPay.bands, perKmAfterMinor: loaded.starterRiderPay.perKmAfterMinor })}>Fill starter suggestion</button>}
          </div>
          <NairaField label="Each km after the last band" minor={riderPay.perKmAfterMinor} onChange={(v) => setRiderPay({ ...riderPay, perKmAfterMinor: v ?? 0 })} />
        </div>
      </div>

      <div className="dp-card"><h2><Scale size={18} aria-hidden="true" />Margin protection</h2>
        <Toggle checked={pricing.margin.protect} onChange={(v) => setP(['margin', 'protect'], v)} label="Never charge less than the rider earns" />
        <NairaField label="Minimum DOORSTEP margin per delivery" minor={pricing.margin.minimumMinor} onChange={(v) => setP(['margin', 'minimumMinor'], v ?? 0)} hint="The fee is raised just enough to keep this margin." />
      </div>

      <div className="dp-card"><h2><CloudRain size={18} aria-hidden="true" />Busy-time boost</h2>
        <p className="dp-muted">Switch on during rain or rush hours. Customers pay a little more and riders earn more, so orders still get picked up.</p>
        <Toggle checked={pricing.boost.active} onChange={(v) => setP(['boost', 'active'], v)} label={pricing.boost.active ? 'Boost is ON' : 'Boost is off'} />
        <div className="dp-grid">
          <label className="dp-field"><span>Label</span><input value={pricing.boost.label} maxLength={40} onChange={(event) => setP(['boost', 'label'], event.target.value)} /></label>
          <NairaField label="Extra for customer" minor={pricing.boost.customerExtraMinor} onChange={(v) => setP(['boost', 'customerExtraMinor'], v ?? 0)} />
          <NairaField label="Extra for rider" minor={pricing.boost.riderExtraMinor} onChange={(v) => setP(['boost', 'riderExtraMinor'], v ?? 0)} />
        </div>
      </div>

      <div className="dp-card"><h2><Route size={18} aria-hidden="true" />Distance accuracy</h2>
        <p className="dp-muted">Prices use the shortest road route. These guards stop bad pins or routing gaps from producing wild prices.</p>
        <div className="dp-grid">
          <NumberField label="Max delivery distance" value={pricing.distance.maxDeliveryKm} suffix="km" step="0.5" onChange={(v) => setP(['distance', 'maxDeliveryKm'], v)} />
          <NumberField label="Detour allowance when routing is down" value={pricing.distance.detourFactor} suffix="×" step="0.05" onChange={(v) => setP(['distance', 'detourFactor'], v)} hint="Road ≈ straight line × this" />
          <NumberField label="Longest believable detour" value={pricing.distance.maxRoadToStraightRatio} suffix="×" step="0.1" onChange={(v) => setP(['distance', 'maxRoadToStraightRatio'], v)} hint="Longer routes are capped and flagged" />
          <NumberField label="Assumed trip when a pin is missing" value={pricing.distance.assumedKm} suffix="km" step="0.5" onChange={(v) => setP(['distance', 'assumedKm'], v)} />
        </div>
      </div>
    </>}

    {tab === 'areas' && <>
      <div className="dp-card"><h2><MapPin size={18} aria-hidden="true" />Sapele areas <small>{placedCount}/{pricing.zones.length} placed</small></h2>
        <p className="dp-muted">Place each area’s centre on the map. Customers who choose an area instead of an exact pin are priced from it, and you can add a surcharge or rider bonus for hard-to-reach areas.</p>
        <ul className="dp-zones">{pricing.zones.map((zone, index) => <li key={zone.id} className={zone.active ? '' : 'is-off'}>
          <div className="dp-zone-head"><b>{zone.name}{DIRECTORY_BY_ID.get(zone.id) && <small className="dp-zone-meta">{DIRECTORY_BY_ID.get(zone.id).postcode || 'postcode to confirm'} · {(DIRECTORY_BY_ID.get(zone.id).streets?.length || 0) + (DIRECTORY_BY_ID.get(zone.id).localities?.length || 0)} streets/places</small>}</b><span className={isPoint(zone) ? 'dp-pill is-ok' : 'dp-pill'}>{isPoint(zone) ? 'Placed' : 'Not placed'}</span>
            <button type="button" className="dp-link" onClick={() => setMapSheet({ mode: 'area', index, value: { name: zone.name, ...(isPoint(zone) ? { area: { latitude: zone.latitude, longitude: zone.longitude, label: zone.name } } : {}) } })}><MapIcon size={14} />{isPoint(zone) ? 'Move' : 'Place'}</button></div>
          <div className="dp-grid is-tight">
            <NumberField label="Radius" value={zone.radiusMeters} suffix="m" step="50" onChange={(v) => setP(['zones', index, 'radiusMeters'], Math.round(v))} />
            <NairaField label="Customer surcharge" minor={zone.customerSurchargeMinor} onChange={(v) => setP(['zones', index, 'customerSurchargeMinor'], v ?? 0)} />
            <NairaField label="Rider bonus" minor={zone.riderBonusMinor} onChange={(v) => setP(['zones', index, 'riderBonusMinor'], v ?? 0)} />
          </div>
          <div className="dp-row-actions"><Toggle checked={zone.active} onChange={(v) => setP(['zones', index], { ...zone, active: v })} label="Active" />
            <button type="button" className="dp-icon" aria-label={`Delete ${zone.name}`} onClick={() => { if (pricing.routeRules.some((rule) => rule.fromZoneId === zone.id || rule.toZoneId === zone.id)) return setError(`${zone.name} is used by an agreed price. Remove that first.`); setP(['zones'], pricing.zones.filter((_, i) => i !== index)) }}><Trash2 size={16} /></button></div>
        </li>)}</ul>
        {(() => { const missing = starterZones().filter((seed) => !pricing.zones.some((zone) => zone.id === seed.id)); return missing.length > 0 && <button type="button" className="dp-link" onClick={() => setP(['zones'], [...pricing.zones, ...missing])}><Plus size={15} />Add {missing.length} area{missing.length > 1 ? 's' : ''} from the Sapele directory</button> })()}
        <form className="dp-add" onSubmit={(event) => { event.preventDefault(); const input = event.currentTarget.elements.namedItem('zone'); addZone(input.value); input.value = '' }}><input name="zone" placeholder="Add an area, e.g. Okotie-Eboh" maxLength={60} /><button type="submit" className="dp-link"><Plus size={15} />Add</button></form>
      </div>
      {unpinned.length > 0 && <div className="dp-card dp-alert"><Store size={18} aria-hidden="true" /><div><b>{unpinned.length} business{unpinned.length > 1 ? 'es have' : ' has'} no map pin</b><p className="dp-muted">Orders from them are priced on an assumed {pricing.distance.assumedKm} km and the rider’s pay needs checking. Ask them to set their location in their DOORSTEP account.</p><p className="dp-muted">{unpinned.slice(0, 12).map((entry) => entry.name).join(', ')}{unpinned.length > 12 ? '…' : ''}</p></div></div>}
    </>}

    {tab === 'agreed' && <div className="dp-card"><h2><Handshake size={18} aria-hidden="true" />Agreed route prices</h2>
      <p className="dp-muted">Fix the price between two areas — for a long detour, a bad road, or an amount you negotiated with riders. Leave a field empty to keep using the formula for that part.</p>
      {pricing.routeRules.length === 0 && <p className="dp-empty">No agreed prices yet.</p>}
      <ul className="dp-rules">{pricing.routeRules.map((rule, index) => {
        const margin = rule.customerFeeMinor != null && rule.riderPayMinor != null ? rule.customerFeeMinor - rule.riderPayMinor : null
        const update = (patch) => setP(['routeRules', index], { ...rule, ...patch })
        return <li key={rule.id} className={rule.active ? '' : 'is-off'}>
          <div className="dp-grid is-tight">
            <label className="dp-field"><span>From</span><select value={rule.fromZoneId} onChange={(event) => update({ fromZoneId: event.target.value })}>{pricing.zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</select></label>
            <label className="dp-field"><span>To</span><select value={rule.toZoneId} onChange={(event) => update({ toZoneId: event.target.value })}>{pricing.zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</select></label>
            <NairaField label="Customer pays" minor={rule.customerFeeMinor} allowEmpty onChange={(v) => update({ customerFeeMinor: v })} />
            <NairaField label="Rider earns" minor={rule.riderPayMinor} allowEmpty onChange={(v) => update({ riderPayMinor: v })} />
            <label className="dp-field"><span>Agreed with</span><input value={rule.agreedWith} maxLength={80} placeholder="All riders, or a rider’s name" onChange={(event) => update({ agreedWith: event.target.value })} /></label>
            <label className="dp-field"><span>Note</span><input value={rule.note} maxLength={200} placeholder="Why this price" onChange={(event) => update({ note: event.target.value })} /></label>
          </div>
          <div className="dp-row-actions">
            <Toggle checked={rule.bothWays} onChange={(v) => update({ bothWays: v })} label="Both directions" />
            <Toggle checked={rule.active} onChange={(v) => update({ active: v })} label="Active" />
            {margin != null && <span className={margin < 0 ? 'dp-pill is-bad' : 'dp-pill is-ok'}>Margin {money(margin)}</span>}
            <button type="button" className="dp-icon" aria-label="Delete agreed price" onClick={() => setP(['routeRules'], pricing.routeRules.filter((_, i) => i !== index))}><Trash2 size={16} /></button>
          </div>
        </li>
      })}</ul>
      <button type="button" className="dp-link" onClick={addRule}><Plus size={15} />Add agreed price</button>
    </div>}

    <div className="dp-savebar" role="region" aria-label="Save delivery pricing">
      <div>{error ? <span className="dp-error">{error}</span> : message ? <span className="dp-ok">{message}</span> : <span>{dirty ? 'Unsaved changes' : 'All changes saved'}</span>}</div>
      <div className="dp-savebar-actions">
        {dirty && <button type="button" className="dp-ghost" disabled={saving} onClick={() => { setPricing(structuredClone(loaded.pricing)); setRiderPay(structuredClone(loaded.finance.riderPay)); setError(''); setMessage('') }}><X size={15} />Discard</button>}
        <button type="button" className="dp-ghost" disabled={saving || !dirty} onClick={() => save()}><Save size={15} />Save</button>
        <button type="button" className={pricing.published ? 'dp-ghost' : 'dp-primary'} disabled={saving} onClick={() => save(!pricing.published)}>{pricing.published ? 'Unpublish' : 'Publish'}</button>
      </div>
    </div>

    {mapSheet && <MapSheet mode={mapSheet.mode}
      value={mapSheet.mode === 'route' ? { ...(isPoint(calc.pickup) ? { pickup: calc.pickup } : {}), ...(isPoint(calc.dropoff) ? { dropoff: calc.dropoff } : {}) } : mapSheet.value}
      onClose={() => setMapSheet(null)}
      onDone={(points) => {
        if (mapSheet.mode === 'route') setCalc({ ...calc, pickup: { latitude: points.pickup.latitude, longitude: points.pickup.longitude, label: points.pickup.label || 'Pin A' }, dropoff: { latitude: points.dropoff.latitude, longitude: points.dropoff.longitude, label: points.dropoff.label || 'Pin B' } })
        else setP(['zones', mapSheet.index], { ...pricing.zones[mapSheet.index], latitude: Number(points.area.latitude.toFixed(7)), longitude: Number(points.area.longitude.toFixed(7)) })
        setMapSheet(null)
      }} />}
  </section>
}
