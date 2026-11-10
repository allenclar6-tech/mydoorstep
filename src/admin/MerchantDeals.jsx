import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, ChevronRight, Search } from 'lucide-react'
import { apiBase } from '../config/apiBase'
import './merchantDeals.css'

// Admin › Business delivery deals: who pays delivery for each business's orders. The delivery fee itself is still
// worked out by DOORSTEP's pricing; the deal only splits it. Riders are paid the same either way.

const headers = () => { let token = null; try { token = localStorage.getItem('doorstep-admin-token') } catch { token = null } return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
async function call(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, { ...options, headers: headers() })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.message || (response.status === 403 ? 'Your role can’t change delivery deals.' : 'That didn’t work. Try again.'))
  return body
}
const naira = (minor) => `₦${(Math.round(minor || 0) / 100).toLocaleString('en-NG')}`
const toMinor = (text) => (text === '' || text == null ? undefined : Math.round(Number(text) * 100))
const toText = (minor) => (minor == null ? '' : String(Math.round(minor / 100)))
const MODES = [
  ['STANDARD', 'Customer pays', 'No deal. Customers pay the delivery fee.'],
  ['MERCHANT_PAYS', 'Business pays', 'Customers see free delivery; the business pays the fee from its share.'],
  ['SHARED', 'Shared', 'The business pays a percentage; the customer pays the rest.'],
  ['FIXED_FEE', 'Fixed fee', 'Customers always pay one amount; the gap is covered by the business or DOORSTEP.'],
  ['PLATFORM_PAYS', 'DOORSTEP pays', 'Free delivery funded by DOORSTEP (a promotion).'],
]

function Editor({ business, onBack, onSaved }) {
  const existing = business.deal || {}
  const [form, setForm] = useState({ mode: existing.mode || 'STANDARD', merchantPercent: existing.merchantPercent ?? '', merchantCap: toText(existing.merchantCapMinor), fixedFee: toText(existing.fixedFeeMinor), fixedGapPaidBy: existing.fixedGapPaidBy || 'PLATFORM', freeOver: toText(existing.freeOverMinor), freeOverPaidBy: existing.freeOverPaidBy || 'MERCHANT', startsAt: existing.startsAt ? existing.startsAt.slice(0, 10) : '', endsAt: existing.endsAt ? existing.endsAt.slice(0, 10) : '', note: existing.note || '' })
  const [sample, setSample] = useState({ fee: '1500', subtotal: '6000' })
  const [preview, setPreview] = useState(null)
  const [state, setState] = useState({ busy: false, error: '', ok: '' })
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const deal = () => {
    const value = { mode: form.mode }
    if (form.mode === 'SHARED') value.merchantPercent = Number(form.merchantPercent)
    if (['MERCHANT_PAYS', 'SHARED', 'FIXED_FEE'].includes(form.mode) && form.merchantCap !== '') value.merchantCapMinor = toMinor(form.merchantCap)
    if (form.mode === 'FIXED_FEE') { value.fixedFeeMinor = toMinor(form.fixedFee); value.fixedGapPaidBy = form.fixedGapPaidBy }
    if (form.freeOver !== '') { value.freeOverMinor = toMinor(form.freeOver); value.freeOverPaidBy = form.freeOverPaidBy }
    if (form.startsAt) value.startsAt = new Date(`${form.startsAt}T00:00:00+01:00`).toISOString()
    if (form.endsAt) value.endsAt = new Date(`${form.endsAt}T00:00:00+01:00`).toISOString()
    if (form.note.trim()) value.note = form.note.trim()
    return value
  }
  useEffect(() => {
    const timer = setTimeout(() => {
      call('/api/admin/merchant-deals/preview', { method: 'POST', body: JSON.stringify({ deal: deal(), feeMinor: toMinor(sample.fee) || 0, subtotalMinor: toMinor(sample.subtotal) || 0 }) }).then((body) => { setPreview(body.split); setState((current) => ({ ...current, error: '' })) }).catch((error) => { setPreview(null); setState((current) => ({ ...current, error: error.message })) })
    }, 300)
    return () => clearTimeout(timer)
  }, [JSON.stringify(form), sample.fee, sample.subtotal])
  const save = async () => {
    if (!window.confirm(`Save this delivery deal for ${business.name}? It applies to new orders${form.startsAt ? ` from ${form.startsAt}` : ' straight away'}.`)) return
    setState({ busy: true, error: '', ok: '' })
    try { await call(`/api/admin/merchant-deals/${business.id}`, { method: 'PUT', body: JSON.stringify({ deal: form.mode === 'STANDARD' && form.freeOver === '' ? null : deal() }) }); setState({ busy: false, error: '', ok: 'Saved. New orders use this deal.' }); onSaved() } catch (error) { setState({ busy: false, error: error.message, ok: '' }) }
  }
  const num = (key, props = {}) => <input inputMode="numeric" value={form[key]} onChange={(event) => set(key, event.target.value.replace(/[^\d]/g, '').slice(0, 7))} {...props} />

  return <div className="md">
    <button type="button" className="md-btn is-quiet" onClick={onBack}><ArrowLeft size={16} />All businesses</button>
    <section className="md-card">
      <header className="md-card-head"><div><h2>{business.name}</h2><p>{business.address}</p></div>{business.ownRiders && <span className="md-pill is-warn">Uses its own riders: deals only apply when a DOORSTEP rider delivers</span>}</header>
      <fieldset className="md-modes"><legend>Who pays delivery</legend>{MODES.map(([mode, name, text]) => <label key={mode} className={form.mode === mode ? 'is-on' : ''}><input type="radio" name="mode" checked={form.mode === mode} onChange={() => set('mode', mode)} /><span><b>{name}</b><small>{text}</small></span></label>)}</fieldset>
      <div className="md-grid">
        {form.mode === 'SHARED' && <label>Business pays (%)<input inputMode="decimal" value={form.merchantPercent} onChange={(event) => set('merchantPercent', event.target.value.replace(/[^\d.]/g, '').slice(0, 5))} placeholder="e.g. 50" /></label>}
        {form.mode === 'FIXED_FEE' && <><label>Customers pay (₦){num('fixedFee', { placeholder: 'e.g. 500' })}</label>
          <label>If the real fee is higher, who pays the rest?<select value={form.fixedGapPaidBy} onChange={(event) => set('fixedGapPaidBy', event.target.value)}><option value="PLATFORM">DOORSTEP</option><option value="MERCHANT">The business</option></select></label></>}
        {['MERCHANT_PAYS', 'SHARED', 'FIXED_FEE'].includes(form.mode) && <label>Most the business pays per order (₦, optional){num('merchantCap', { placeholder: 'No limit' })}</label>}
        <label>Free delivery on orders of at least (₦, optional){num('freeOver', { placeholder: 'Off' })}</label>
        {form.freeOver !== '' && <label>Free delivery paid by<select value={form.freeOverPaidBy} onChange={(event) => set('freeOverPaidBy', event.target.value)}><option value="MERCHANT">The business</option><option value="PLATFORM">DOORSTEP</option></select></label>}
        <label>Starts (optional)<input type="date" value={form.startsAt} onChange={(event) => set('startsAt', event.target.value)} /></label>
        <label>Ends (optional)<input type="date" value={form.endsAt} min={form.startsAt || undefined} onChange={(event) => set('endsAt', event.target.value)} /></label>
        <label className="is-wide">Note (who agreed it, contract reference)<input maxLength={300} value={form.note} onChange={(event) => set('note', event.target.value)} placeholder="e.g. Agreed with the owner on 10 Nov, 3-month trial" /></label>
      </div>
    </section>

    <section className="md-card">
      <h3>Check it before saving</h3>
      <div className="md-grid is-sample"><label>Example delivery fee (₦)<input inputMode="numeric" value={sample.fee} onChange={(event) => setSample({ ...sample, fee: event.target.value.replace(/[^\d]/g, '').slice(0, 6) })} /></label><label>Example basket (₦)<input inputMode="numeric" value={sample.subtotal} onChange={(event) => setSample({ ...sample, subtotal: event.target.value.replace(/[^\d]/g, '').slice(0, 7) })} /></label></div>
      {preview && <dl className="md-split">
        <div><dt>Customer pays</dt><dd>{naira(preview.customerMinor)}</dd></div>
        <div><dt>Business pays</dt><dd>{naira(preview.merchantMinor)}</dd></div>
        <div><dt>DOORSTEP pays</dt><dd>{naira(preview.platformMinor)}</dd></div>
      </dl>}
      <p className="md-muted">The rider is paid for the trip as usual. The business’s part comes out of its share of the order and shows on its statement.</p>
    </section>
    {state.error && <p className="md-alert" role="alert">{state.error}</p>}
    {state.ok && <p className="md-ok" role="status">{state.ok}</p>}
    <div className="md-actions"><button type="button" className="md-btn is-primary" disabled={state.busy || !preview} onClick={save}>{state.busy ? 'Saving…' : 'Save deal'}</button></div>
  </div>
}

export function MerchantDeals() {
  const [q, setQ] = useState('')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null)
  const load = useCallback(() => call(`/api/admin/merchant-deals${q ? `?q=${encodeURIComponent(q)}` : ''}`).then((body) => { setData(body); setError('') }).catch((loadError) => setError(loadError.message)), [q])
  useEffect(() => { const timer = setTimeout(load, 250); return () => clearTimeout(timer) }, [load])
  if (open) return <Editor business={open} onBack={() => { setOpen(null); load() }} onSaved={load} />
  return <div className="md">
    <label className="md-search"><Search size={16} aria-hidden="true" /><input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Find a business" aria-label="Find a business" /></label>
    {error && <p className="md-alert" role="alert">{error}</p>}
    {!data && !error && <div className="md-skeleton" role="status" aria-label="Loading"><span /><span /><span /></div>}
    {data && <ul className="md-list">{data.businesses.map((business) => <li key={business.id}><button type="button" onClick={() => setOpen(business)}>
      <span><b>{business.name}</b><small>{business.deal.text}</small></span>
      {business.deal.mode !== 'STANDARD' || business.deal.freeOverMinor != null ? <span className={`md-pill ${business.deal.active ? 'is-on' : 'is-off'}`}>{business.deal.active ? 'Active' : 'Scheduled or ended'}</span> : null}
      <ChevronRight size={18} aria-hidden="true" />
    </button></li>)}</ul>}
    {data && !data.businesses.length && <p className="md-muted">No approved businesses match.</p>}
  </div>
}
