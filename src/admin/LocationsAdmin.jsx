import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, Download, FileJson, MapPin, Plus, Search, ShieldCheck } from 'lucide-react'
import { apiBase } from '../config/apiBase'
import { LocationsMap, STATUS_COLORS } from './LocationsMap'

// Admin › Locations: the auditable Sapele location directory. Pins, verification evidence, local confirmations,
// separately-approved delivery coverage, and the switch that turns an approved area into a delivery zone.

const token = () => { try { return localStorage.getItem('doorstep-admin-token') } catch { return null } }
async function call(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${apiBase}${path}`, { method, headers: { Authorization: `Bearer ${token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Something went wrong. Try again.')
  return data
}
async function download(format) {
  const response = await fetch(`${apiBase}/api/admin/locations/export?format=${format}`, { headers: { Authorization: `Bearer ${token()}` } })
  if (!response.ok) throw new Error('Export failed.')
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = `doorstep-sapele-locations.${format}`; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}
const STATUS_LABEL = { pending: 'Pending', needs_review: 'Needs review', needs_local_verification: 'Needs local check', verified: 'Verified', rejected: 'Rejected' }
const BOUNDARY_LABEL = { none: 'No coverage', draft: 'Coverage draft', needs_review: 'Coverage awaiting review', approved: 'Coverage approved', rejected: 'Coverage rejected' }
const money = (minor) => `₦${((minor || 0) / 100).toLocaleString('en-NG')}`
const fmtDate = (value) => value ? new Date(value).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }) : '—'

function StatusPill({ status }) { return <span className="la-pill" style={{ '--c': STATUS_COLORS[status] || '#6b7280' }}>{STATUS_LABEL[status] || status}</span> }

function Section({ title, children, defaultOpen = false }) {
  return <details className="la-section" open={defaultOpen}><summary>{title}</summary><div className="la-section-body">{children}</div></details>
}

function Detail({ id, labels, reviewer, all, onChanged, mapMode, setMapMode, draftPin, setDraftPin, ring, setRing }) {
  const [data, setData] = useState(null)
  const [message, setMessage] = useState({ tone: '', text: '' })
  const [form, setForm] = useState({})
  const [statusForm, setStatusForm] = useState({ status: '', method: 'MAP_REVIEW', notes: '', source: '', sourceUrl: '' })
  const [evidence, setEvidence] = useState({ source: '', url: '', method: 'DESK_RESEARCH', note: '' })
  const [radius, setRadius] = useState('')
  const [samples, setSamples] = useState([{ label: '', latitude: '', longitude: '', expectInside: true }, { label: '', latitude: '', longitude: '', expectInside: false }])
  const [testResults, setTestResults] = useState(null)
  const [decision, setDecision] = useState({ notes: '', acceptRadiusLimitations: false })
  const [merge, setMerge] = useState({ intoId: '', notes: '', confirm: false })
  const load = useCallback(async () => {
    try {
      const body = await call(`/api/admin/locations/${id}`)
      setData(body)
      const row = body.location
      setForm({ name: row.name, localityType: row.localityType, alternativeNames: (row.alternativeNames || []).join(', '), nearestLandmark: row.nearestLandmark || '', latitude: row.latitude ?? '', longitude: row.longitude ?? '', customerSurchargeMinor: row.customerSurchargeMinor / 100, riderBonusMinor: row.riderBonusMinor / 100, minimumOrderMinor: row.minimumOrderMinor != null ? row.minimumOrderMinor / 100 : '', closedUntil: row.closedUntil ? row.closedUntil.slice(0, 16) : '', closedReason: row.closedReason || '', isActive: row.isActive, reason: '' })
      setRadius(row.coverageRadiusMeters || '')
    } catch (error) { setMessage({ tone: 'error', text: error.message }) }
  }, [id])
  useEffect(() => { setData(null); setMessage({ tone: '', text: '' }); setTestResults(null); load() }, [load])
  useEffect(() => { if (draftPin) setForm((current) => ({ ...current, latitude: draftPin.latitude, longitude: draftPin.longitude })) }, [draftPin])
  if (!data) return <div className="la-card">{message.text ? <p className="la-error">{message.text}</p> : 'Loading…'}</div>
  const row = data.location
  const act = async (fn, ok) => { setMessage({ tone: '', text: '' }); try { const result = await fn(); setMessage({ tone: 'ok', text: typeof ok === 'function' ? ok(result) : ok }); await load(); onChanged() } catch (error) { setMessage({ tone: 'error', text: error.message }) } }
  const saveEdits = () => act(() => {
    const lat = form.latitude === '' ? null : Number(form.latitude)
    const lng = form.longitude === '' ? null : Number(form.longitude)
    return call(`/api/admin/locations/${id}`, { method: 'PATCH', body: { name: form.name, localityType: form.localityType, alternativeNames: form.alternativeNames.split(',').map((value) => value.trim()).filter(Boolean), nearestLandmark: form.nearestLandmark || null, latitude: lat, longitude: lng, isActive: form.isActive, customerSurchargeMinor: Math.round(Number(form.customerSurchargeMinor || 0) * 100), riderBonusMinor: Math.round(Number(form.riderBonusMinor || 0) * 100), minimumOrderMinor: form.minimumOrderMinor === '' ? null : Math.round(Number(form.minimumOrderMinor) * 100), closedUntil: form.closedUntil ? new Date(form.closedUntil).toISOString() : null, closedReason: form.closedReason || null, ...(form.reason ? { reason: form.reason } : {}) } })
  }, (result) => { setMapMode('view'); setDraftPin(null); return result.requiresReverification?.length ? 'Saved. Because the pin or coverage changed, it must be verified (and coverage approved) again before use.' : 'Saved.' })
  const blockers = row.blockers || []
  const evidenceList = Array.isArray(row.evidence) ? row.evidence : []
  const pendingReviews = data.reviews.filter((review) => review.status === 'SUBMITTED')

  return <div className="la-card la-detail">
    <header className="la-detail-head">
      <div><span className="la-kicker">{row.candidateNumber ? `CANDIDATE ${row.candidateNumber}` : row.localityType}</span><h2>{row.name}</h2>
        {row.originalCandidateName && row.originalCandidateName !== row.name && <small>Original candidate name: {row.originalCandidateName}</small>}
        {row.alternativeNames?.length > 0 && <small>Also: {row.alternativeNames.join(', ')}</small>}</div>
      <div className="la-head-pills"><StatusPill status={row.verificationStatus} /><span className="la-pill is-plain">{BOUNDARY_LABEL[row.boundaryVerificationStatus]}</span>{row.deliveryEnabled ? <span className="la-pill" style={{ '--c': '#007c63' }}>Delivering</span> : <span className="la-pill is-plain">Not a delivery zone</span>}{row.mergedIntoId && <span className="la-pill" style={{ '--c': '#b3261e' }}>Merged</span>}</div>
    </header>
    {message.text && <p className={message.tone === 'error' ? 'la-error' : 'la-ok'} role="status">{message.text}</p>}
    {row.flags?.length > 0 && <ul className="la-flags">{row.flags.map((flag) => <li key={flag}><AlertTriangle size={14} aria-hidden="true" />{labels.flags[flag] || flag}</li>)}</ul>}
    {row.verificationNotes && <p className="la-notes">{row.verificationNotes}</p>}
    <dl className="la-facts">
      <div><dt>Pin</dt><dd>{row.latitude != null ? `${row.latitude}, ${row.longitude}` : 'None'}</dd></div>
      {row.referenceLatitude != null && <div><dt>Preliminary reference</dt><dd>{row.referenceLatitude}, {row.referenceLongitude} <small>({row.referenceSource})</small></dd></div>}
      <div><dt>Method</dt><dd>{labels.methods[row.verificationMethod] || '—'}</dd></div>
      <div><dt>Source</dt><dd>{row.verificationSourceUrl ? <a href={row.verificationSourceUrl} target="_blank" rel="noreferrer">{row.verificationSource || row.verificationSourceUrl}</a> : row.verificationSource || '—'}</dd></div>
      <div><dt>Checked</dt><dd>{fmtDate(row.verificationCheckedAt)}{row.reviewerId ? ` · reviewer ${row.reviewerId}` : ''}</dd></div>
      <div><dt>Landmark</dt><dd>{row.nearestLandmark || '—'}</dd></div>
    </dl>

    <Section title="Edit name, pin, landmark and delivery settings" defaultOpen={false}>
      <div className="la-grid">
        <label>Name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label>Type<select value={form.localityType} onChange={(event) => setForm({ ...form, localityType: event.target.value })}>{labels.types.map((type) => <option key={type}>{type}</option>)}</select></label>
        <label className="la-wide">Other names / spellings (comma separated)<input value={form.alternativeNames} onChange={(event) => setForm({ ...form, alternativeNames: event.target.value })} /></label>
        <label className="la-wide">Nearest landmark<input value={form.nearestLandmark} onChange={(event) => setForm({ ...form, nearestLandmark: event.target.value })} /></label>
        <label>Latitude<input inputMode="decimal" value={form.latitude} onChange={(event) => setForm({ ...form, latitude: event.target.value })} /></label>
        <label>Longitude<input inputMode="decimal" value={form.longitude} onChange={(event) => setForm({ ...form, longitude: event.target.value })} /></label>
      </div>
      <button type="button" className="la-link" onClick={() => setMapMode(mapMode === 'pin' ? 'view' : 'pin')}><MapPin size={14} />{mapMode === 'pin' ? 'Stop moving the pin' : 'Move the pin on the map'}</button>
      <div className="la-grid">
        <label>Customer surcharge (₦)<input type="number" min="0" value={form.customerSurchargeMinor} onChange={(event) => setForm({ ...form, customerSurchargeMinor: event.target.value })} /></label>
        <label>Rider bonus (₦)<input type="number" min="0" value={form.riderBonusMinor} onChange={(event) => setForm({ ...form, riderBonusMinor: event.target.value })} /></label>
        <label>Minimum order (₦)<input type="number" min="0" value={form.minimumOrderMinor} placeholder="None" onChange={(event) => setForm({ ...form, minimumOrderMinor: event.target.value })} /></label>
        <label>Paused until<input type="datetime-local" value={form.closedUntil} onChange={(event) => setForm({ ...form, closedUntil: event.target.value })} /></label>
        <label className="la-wide">Pause reason<input value={form.closedReason} onChange={(event) => setForm({ ...form, closedReason: event.target.value })} placeholder="e.g. flooding on the access road" /></label>
        <label className="la-check"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />Active record</label>
        <label className="la-wide">Reason for change (logged)<input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></label>
      </div>
      <p className="la-muted">Moving the pin more than 100 m, or changing coverage, cancels verification and coverage approval until reviewed again.</p>
      <button type="button" className="la-primary" onClick={saveEdits}>Save changes</button>
    </Section>

    <Section title={`Evidence (${evidenceList.length})`}>
      <ol className="la-evidence">{evidenceList.map((entry, index) => <li key={index}><b>{entry.kind}</b> · {entry.source || entry.method || ''}{entry.url && <> · <a href={entry.url} target="_blank" rel="noreferrer">link</a></>}{entry.latitude != null && <> · {entry.latitude}, {entry.longitude}</>}{entry.note && <p>{entry.note}</p>}{entry.results && <p>{entry.results.map((result) => `${result.label}: ${result.inside ? 'inside' : 'outside'} ${result.passed ? '✓' : '✗'}`).join(' · ')}</p>}<small>{entry.checkedAt || entry.at || ''}{entry.by ? ` · ${entry.by}` : ''}</small></li>)}</ol>
      <div className="la-grid">
        <label className="la-wide">Source<input value={evidence.source} onChange={(event) => setEvidence({ ...evidence, source: event.target.value })} placeholder="e.g. OpenStreetMap node 123, rider call with Efe" /></label>
        <label className="la-wide">Link (optional)<input value={evidence.url} onChange={(event) => setEvidence({ ...evidence, url: event.target.value })} /></label>
        <label className="la-wide">Method<select value={evidence.method} onChange={(event) => setEvidence({ ...evidence, method: event.target.value })}>{Object.entries(labels.methods).filter(([key]) => key !== 'IMPORT_REFERENCE').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="la-wide">Note<textarea rows={2} value={evidence.note} onChange={(event) => setEvidence({ ...evidence, note: event.target.value })} /></label>
      </div>
      <button type="button" className="la-ghost" onClick={() => act(() => call(`/api/admin/locations/${id}/evidence`, { method: 'POST', body: { source: evidence.source, method: evidence.method, ...(evidence.url ? { url: evidence.url } : {}), ...(evidence.note ? { note: evidence.note } : {}) } }), 'Evidence recorded.').then(() => setEvidence({ source: '', url: '', method: 'DESK_RESEARCH', note: '' }))}><Plus size={14} />Add evidence</button>
    </Section>

    {pendingReviews.length > 0 && <Section title={`Local checks waiting (${pendingReviews.length})`} defaultOpen>
      {pendingReviews.map((review) => <div key={review.id} className="la-review">
        <p><b>{review.confirmationType === 'PHYSICAL' ? 'Checked on site' : 'Checked remotely'}</b> by {review.submitterRole.toLowerCase()} · {fmtDate(review.createdAt)}</p>
        <p>Name {review.nameConfirmed ? 'confirmed' : `not confirmed${review.suggestedName ? ` — suggests "${review.suggestedName}"` : ''}`}{review.suggestedLatitude != null ? ` · suggests pin ${review.suggestedLatitude}, ${review.suggestedLongitude}` : ''}{review.landmark ? ` · landmark: ${review.landmark}` : ''}</p>
        <p className="la-muted">{review.notes}</p>
        {reviewer.canReview ? <div className="la-row">
          <button type="button" className="la-primary" onClick={() => act(() => call(`/api/admin/location-reviews/${review.id}/decision`, { method: 'POST', body: { decision: 'accept', applyPin: review.suggestedLatitude != null, applyName: Boolean(review.suggestedName) } }), 'Accepted and added as evidence. Now review the status.')}>Accept{review.suggestedLatitude != null || review.suggestedName ? ' and apply suggestions' : ''}</button>
          <button type="button" className="la-ghost" onClick={() => act(() => call(`/api/admin/location-reviews/${review.id}/decision`, { method: 'POST', body: { decision: 'decline' } }), 'Declined.')}>Decline</button>
        </div> : <p className="la-muted">An authorised reviewer must decide.</p>}
      </div>)}
    </Section>}

    <Section title="Verification decision" defaultOpen>
      <div className="la-grid">
        <label>New status<select value={statusForm.status} onChange={(event) => setStatusForm({ ...statusForm, status: event.target.value })}><option value="">Choose…</option>{labels.statuses.map((status) => <option key={status} value={status} disabled={['verified', 'rejected'].includes(status) && !reviewer.canReview}>{STATUS_LABEL[status]}</option>)}</select></label>
        <label>How it was checked<select value={statusForm.method} onChange={(event) => setStatusForm({ ...statusForm, method: event.target.value })}>{Object.entries(labels.methods).filter(([key]) => key !== 'IMPORT_REFERENCE').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="la-wide">Notes (logged)<textarea rows={3} value={statusForm.notes} onChange={(event) => setStatusForm({ ...statusForm, notes: event.target.value })} placeholder="What you checked, against what, and anything still uncertain." /></label>
      </div>
      <p className="la-muted">“Verified” needs a pin, recorded evidence, and a map review or local (remote or physical) confirmation. Imported or single-source desk research is not enough.</p>
      <button type="button" className="la-primary" disabled={!statusForm.status} onClick={() => act(() => call(`/api/admin/locations/${id}/status`, { method: 'POST', body: { status: statusForm.status, method: statusForm.method, notes: statusForm.notes } }), 'Status updated.')}><ShieldCheck size={14} />Record decision</button>
    </Section>

    <Section title={`Delivery coverage — ${BOUNDARY_LABEL[row.boundaryVerificationStatus]}`}>
      <p className="la-muted">The centre pin is not the boundary. Draw the area DOORSTEP will serve, test real addresses inside and outside it, then a reviewer approves it.</p>
      <div className="la-row">
        <button type="button" className="la-ghost" onClick={() => { setMapMode(mapMode === 'draw' ? 'view' : 'draw'); if (mapMode !== 'draw') setRing([]) }}>{mapMode === 'draw' ? 'Stop drawing' : 'Draw boundary on the map'}</button>
        {mapMode === 'draw' && <><span className="la-muted">{ring.length} corner{ring.length === 1 ? '' : 's'}</span><button type="button" className="la-link" onClick={() => setRing(ring.slice(0, -1))}>Undo</button><button type="button" className="la-link" onClick={() => setRing([])}>Clear</button>
          <button type="button" className="la-primary" disabled={ring.length < 3} onClick={() => act(() => call(`/api/admin/locations/${id}/coverage`, { method: 'PUT', body: { method: 'POLYGON', geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]].map((point) => [point.longitude, point.latitude])] } } }), 'Boundary submitted for review.').then(() => { setMapMode('view'); setRing([]) })}>Submit boundary</button></>}
      </div>
      <div className="la-row"><label className="la-inline">Or a circle of<input type="number" min="100" max="10000" step="50" value={radius} onChange={(event) => setRadius(event.target.value)} />m</label><button type="button" className="la-ghost" disabled={!radius} onClick={() => act(() => call(`/api/admin/locations/${id}/coverage`, { method: 'PUT', body: { method: 'RADIUS', radiusMeters: Number(radius) } }), 'Radius submitted. A reviewer must explicitly accept its limitations.')}>Submit radius</button></div>
      {row.coverageMethod && <>
        <h4>Test sample addresses</h4>
        {samples.map((sample, index) => <div className="la-sample" key={index}>
          <input placeholder="Address label" value={sample.label} onChange={(event) => setSamples(samples.map((entry, i) => i === index ? { ...entry, label: event.target.value } : entry))} />
          <input placeholder="Lat" inputMode="decimal" value={sample.latitude} onChange={(event) => setSamples(samples.map((entry, i) => i === index ? { ...entry, latitude: event.target.value } : entry))} />
          <input placeholder="Lng" inputMode="decimal" value={sample.longitude} onChange={(event) => setSamples(samples.map((entry, i) => i === index ? { ...entry, longitude: event.target.value } : entry))} />
          <select value={sample.expectInside ? 'in' : 'out'} onChange={(event) => setSamples(samples.map((entry, i) => i === index ? { ...entry, expectInside: event.target.value === 'in' } : entry))}><option value="in">Should be inside</option><option value="out">Should be outside</option></select>
        </div>)}
        <div className="la-row"><button type="button" className="la-link" onClick={() => setSamples([...samples, { label: '', latitude: '', longitude: '', expectInside: true }])}><Plus size={14} />Add sample</button>
          <button type="button" className="la-ghost" onClick={() => act(async () => { const result = await call(`/api/admin/locations/${id}/coverage/test`, { method: 'POST', body: { samples: samples.filter((sample) => sample.label && sample.latitude !== '' && sample.longitude !== '').map((sample) => ({ label: sample.label, latitude: Number(sample.latitude), longitude: Number(sample.longitude), expectInside: sample.expectInside })) } }); setTestResults(result.results); return result }, (result) => `${result.results.filter((entry) => entry.passed).length}/${result.results.length} samples behaved as expected.`)}>Run tests</button></div>
        {testResults && <ul className="la-tests">{testResults.map((result, index) => <li key={index} className={result.passed ? 'is-ok' : 'is-bad'}>{result.passed ? '✓' : '✗'} {result.label}: {result.inside ? 'inside' : 'outside'} (expected {result.expectInside ? 'inside' : 'outside'})</li>)}</ul>}
      </>}
      {row.boundaryVerificationStatus === 'needs_review' && (reviewer.canReview ? <div className="la-decision">
        {row.coverageMethod === 'RADIUS' && <label className="la-check"><input type="checkbox" checked={decision.acceptRadiusLimitations} onChange={(event) => setDecision({ ...decision, acceptRadiusLimitations: event.target.checked })} />I accept that a circle is not a real boundary: it may include places outside {row.name} and miss parts of it.</label>}
        <textarea rows={2} placeholder="Review notes (logged)" value={decision.notes} onChange={(event) => setDecision({ ...decision, notes: event.target.value })} />
        <div className="la-row"><button type="button" className="la-primary" onClick={() => act(() => call(`/api/admin/locations/${id}/coverage/decision`, { method: 'POST', body: { decision: 'approve', notes: decision.notes, acceptRadiusLimitations: decision.acceptRadiusLimitations } }), 'Coverage approved.')}>Approve coverage</button><button type="button" className="la-ghost" onClick={() => act(() => call(`/api/admin/locations/${id}/coverage/decision`, { method: 'POST', body: { decision: 'reject', notes: decision.notes } }), 'Coverage rejected.')}>Reject</button></div>
      </div> : <p className="la-muted">Waiting for an authorised reviewer.</p>)}
    </Section>

    <Section title={row.deliveryEnabled ? 'Delivery zone — ON' : 'Delivery zone — off'} defaultOpen={blockers.length === 0}>
      {blockers.length > 0 && <ul className="la-flags">{blockers.map((code) => <li key={code}>{labels.blockers[code] || code}</li>)}</ul>}
      {row.deliveryEnabled
        ? <button type="button" className="la-ghost" onClick={() => act(() => call(`/api/admin/locations/${id}/delivery`, { method: 'POST', body: { enabled: false } }), 'Deliveries switched off for this area.')}>Switch deliveries off</button>
        : <button type="button" className="la-primary" disabled={blockers.length > 0 || !reviewer.canReview} onClick={() => act(() => call(`/api/admin/locations/${id}/delivery`, { method: 'POST', body: { enabled: true } }), 'This area is now a delivery zone.')}>Switch deliveries on</button>}
    </Section>

    {reviewer.canReview && !row.mergedIntoId && <Section title="Merge a duplicate">
      <p className="la-muted">Only merge when evidence shows both records are the same place. The other names become alternative spellings; history and evidence are kept.</p>
      <div className="la-grid">
        <label className="la-wide">Merge “{row.name}” into<select value={merge.intoId} onChange={(event) => setMerge({ ...merge, intoId: event.target.value })}><option value="">Choose…</option>{all.filter((entry) => entry.id !== row.id && !entry.mergedIntoId).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}{entry.originalCandidateName && entry.originalCandidateName !== entry.name ? ` (${entry.originalCandidateName})` : ''}</option>)}</select></label>
        <label className="la-wide">Why they are the same place<textarea rows={2} value={merge.notes} onChange={(event) => setMerge({ ...merge, notes: event.target.value })} /></label>
        <label className="la-check"><input type="checkbox" checked={merge.confirm} onChange={(event) => setMerge({ ...merge, confirm: event.target.checked })} />I confirm these are the same place.</label>
      </div>
      <button type="button" className="la-ghost" disabled={!merge.intoId || !merge.confirm} onClick={() => act(() => call(`/api/admin/locations/${id}/merge`, { method: 'POST', body: { intoId: merge.intoId, notes: merge.notes, confirm: true } }), 'Merged.')}>Merge</button>
    </Section>}

    <Section title={`History (${data.history.length})`}>
      <ol className="la-history">{data.history.map((entry) => <li key={entry.id}><b>{entry.action.replace(/^LOCATION_/, '').replaceAll('_', ' ').toLowerCase()}</b> · {fmtDate(entry.createdAt)} · {entry.actorId}{entry.metadata?.notes ? <p>{entry.metadata.notes}</p> : null}{entry.metadata?.reason ? <p>{entry.metadata.reason}</p> : null}</li>)}</ol>
    </Section>
  </div>
}

export function LocationsAdmin() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [issuesOnly, setIssuesOnly] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [mapMode, setMapMode] = useState('view')
  const [draftPin, setDraftPin] = useState(null)
  const [ring, setRing] = useState([])
  const [adding, setAdding] = useState(false)
  const [newLocation, setNewLocation] = useState({ name: '', localityType: 'VILLAGE', source: '' })
  const [note, setNote] = useState('')
  const load = useCallback(async () => { try { setData(await call('/api/admin/locations')); setError('') } catch (loadError) { setError(loadError.message) } }, [])
  useEffect(() => { load() }, [load])
  const detailSlot = useRef(null)
  useEffect(() => {
    setMapMode('view'); setDraftPin(null); setRing([])
    // On phones the detail sits above the list; bring it into view when a location is picked.
    if (selectedId && window.matchMedia?.('(max-width: 899px)').matches) window.requestAnimationFrame(() => detailSlot.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [selectedId])
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data?.locations || []).filter((row) => (status === 'all' || row.verificationStatus === status || (status === 'zones' && row.deliveryEnabled)) && (!issuesOnly || row.flags.length) && (!q || [row.name, row.originalCandidateName, ...(row.alternativeNames || [])].some((value) => String(value || '').toLowerCase().includes(q))))
  }, [data, query, status, issuesOnly])
  if (error && !data) return <section className="la"><div className="la-card la-error">{error}</div></section>
  if (!data) return <section className="la"><div className="la-card">Loading the location directory…</div></section>
  const s = data.summary
  const selected = data.locations.find((row) => row.id === selectedId)
  return <section className="la">
    <header className="la-hero">
      <span className="la-kicker is-gold">SAPELE LOCATION DIRECTORY</span>
      <h1>Locations & delivery zones</h1>
      <p>{s.total} records · {s.byStatus.verified} verified · {s.byStatus.needs_local_verification} need a local check · {s.byStatus.needs_review} need review · {s.coverageApproved} coverage approved · {s.deliveryZones} delivering</p>
      <div className="la-hero-actions">
        <button type="button" onClick={() => download('csv').catch((exportError) => setNote(exportError.message))}><Download size={14} />CSV</button>
        <button type="button" onClick={() => download('json').catch((exportError) => setNote(exportError.message))}><FileJson size={14} />JSON</button>
        <button type="button" onClick={() => call('/api/admin/locations/seed', { method: 'POST' }).then((result) => { setNote(`Candidate import: ${result.created} added, ${result.alreadyPresent} already present (existing records untouched).`); load() }).catch((seedError) => setNote(seedError.message))}>Import candidate list</button>
        <button type="button" onClick={() => setAdding(!adding)}><Plus size={14} />Add location</button>
      </div>
    </header>
    {!data.reviewer.restricted && <p className="la-banner"><ShieldCheck size={16} aria-hidden="true" />Every admin can currently approve locations. To limit approvals to named reviewers, set LOCATION_REVIEWER_EMAILS on Render.</p>}
    {!data.reviewer.canReview && <p className="la-banner">You can edit and submit, but only authorised reviewers can verify, approve coverage or switch on deliveries.</p>}
    {note && <p className="la-ok">{note}</p>}
    {adding && <div className="la-card la-grid">
      <label>Name<input value={newLocation.name} onChange={(event) => setNewLocation({ ...newLocation, name: event.target.value })} /></label>
      <label>Type<select value={newLocation.localityType} onChange={(event) => setNewLocation({ ...newLocation, localityType: event.target.value })}>{data.labels.types.map((type) => <option key={type}>{type}</option>)}</select></label>
      <label className="la-wide">Where the name comes from<input value={newLocation.source} onChange={(event) => setNewLocation({ ...newLocation, source: event.target.value })} placeholder="e.g. rider Efe, INEC polling unit list" /></label>
      <button type="button" className="la-primary" onClick={() => call('/api/admin/locations', { method: 'POST', body: { name: newLocation.name, localityType: newLocation.localityType, ...(newLocation.source ? { source: newLocation.source } : {}) } }).then((result) => { setAdding(false); setNewLocation({ name: '', localityType: 'VILLAGE', source: '' }); load(); setSelectedId(result.location.id) }).catch((addError) => setNote(addError.message))}>Add (status: pending)</button>
    </div>}
    <LocationsMap locations={data.locations.filter((row) => !row.mergedIntoId)} selectedId={selectedId} onSelect={setSelectedId} mode={selectedId ? mapMode : 'view'} draftPin={draftPin} onPin={setDraftPin} draftRing={ring} onRingPoint={(point) => setRing((current) => [...current, point])} coverage={selected} />
    <div className="la-legend">{Object.entries(STATUS_COLORS).map(([key, color]) => <span key={key}><i style={{ background: color }} />{STATUS_LABEL[key]}</span>)}</div>
    <div className="la-filters">
      <label className="la-search"><Search size={15} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or spelling" /></label>
      <div className="la-chips">{[['all', 'All'], ['needs_local_verification', 'Local check'], ['needs_review', 'Review'], ['pending', 'Pending'], ['verified', 'Verified'], ['rejected', 'Rejected'], ['zones', 'Delivering']].map(([key, label]) => <button type="button" key={key} className={status === key ? 'is-on' : ''} onClick={() => setStatus(key)}>{label}</button>)}<button type="button" className={issuesOnly ? 'is-on' : ''} onClick={() => setIssuesOnly(!issuesOnly)}><AlertTriangle size={13} />Has issues</button></div>
    </div>
    <div className="la-layout">
      <ul className="la-list">{rows.map((row) => <li key={row.id}><button type="button" className={row.id === selectedId ? 'is-on' : ''} onClick={() => setSelectedId(row.id)}>
        <span className="la-dot" style={{ background: STATUS_COLORS[row.verificationStatus] }} />
        <span className="la-list-main"><b>{row.candidateNumber ? `${row.candidateNumber}. ` : ''}{row.name}</b><small>{STATUS_LABEL[row.verificationStatus]}{row.latitude == null ? ' · no pin' : ''}{row.flags.length ? ` · ${row.flags.length} issue${row.flags.length > 1 ? 's' : ''}` : ''}{row.pendingReviews ? ` · ${row.pendingReviews} local check${row.pendingReviews > 1 ? 's' : ''}` : ''}{row.mergedIntoId ? ' · merged' : ''}</small></span>
        {row.deliveryEnabled ? <Check size={16} aria-label="Delivering" /> : null}
      </button></li>)}{rows.length === 0 && <li className="la-muted">No locations match.</li>}</ul>
      {selectedId ? <div className="la-detail-slot" ref={detailSlot}><Detail id={selectedId} labels={data.labels} reviewer={data.reviewer} all={data.locations} onChanged={load} mapMode={mapMode} setMapMode={setMapMode} draftPin={draftPin} setDraftPin={setDraftPin} ring={ring} setRing={setRing} /></div> : <div className="la-card la-muted la-placeholder">Choose a location from the list or the map.</div>}
    </div>
  </section>
}
