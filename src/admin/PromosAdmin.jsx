import { useCallback, useEffect, useState } from 'react'
import { Check, Gift, Pencil, Plus, Power, Store, Tag, X } from 'lucide-react'
import { apiBase } from '../config/apiBase'
import './promosAdmin.css'

// Admin › Promo codes: codes customers type at checkout, and automatic offers such as first-order free delivery.
// DOORSTEP pays every discount out of its own part of the order, so businesses are always paid in full.

const token = () => { try { return localStorage.getItem('doorstep-admin-token') } catch { return null } }
async function call(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${apiBase}${path}`, { method, headers: { Authorization: `Bearer ${token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Something went wrong. Try again.')
  return data
}
const money = (minor) => `₦${Math.round((minor || 0) / 100).toLocaleString('en-NG')}`
const day = (value) => new Date(value).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
const toInput = (value) => { const date = new Date(value); date.setMinutes(date.getMinutes() - date.getTimezoneOffset()); return date.toISOString().slice(0, 16) }
const SECTIONS = [['', 'Every section'], ['FOOD', 'Food'], ['GROCERIES', 'Groceries'], ['SHOPS', 'Shops'], ['PHARMACY_BEAUTY', 'Pharmacy & Beauty']]

const blank = () => ({ name: '', code: '', type: 'PERCENT', percentage: 10, valueNaira: '', maxNaira: 1000, minNaira: 0, description: '', startsAt: toInput(new Date()), endsAt: toInput(new Date(Date.now() + 30 * 86_400_000)), usageLimit: '', perCustomerLimit: 1, firstOrderOnly: false, autoApply: false, showInApp: true, vertical: '', restaurantId: '', active: true })
const welcome = () => ({ ...blank(), name: 'Welcome to DOORSTEP', code: '', type: 'FREE_DELIVERY', description: 'Free delivery on your first order', firstOrderOnly: true, autoApply: true, endsAt: toInput(new Date(Date.now() + 90 * 86_400_000)) })
const fromPromo = (promo) => ({ name: promo.name, code: promo.code || '', type: promo.type, percentage: promo.percentage ?? 10, valueNaira: promo.valueMinor ? promo.valueMinor / 100 : '', maxNaira: promo.maxDiscountMinor ? promo.maxDiscountMinor / 100 : '', minNaira: (promo.minSubtotalMinor || 0) / 100, description: promo.description || '', startsAt: toInput(promo.startsAt), endsAt: toInput(promo.endsAt), usageLimit: promo.usageLimit ?? '', perCustomerLimit: promo.perCustomerLimit || 1, firstOrderOnly: promo.firstOrderOnly, autoApply: promo.autoApply, showInApp: promo.showInApp, vertical: promo.vertical || '', restaurantId: promo.restaurantId || '', active: promo.active })
const toBody = (form) => ({
  name: form.name.trim(), code: form.code.trim() || null, type: form.type,
  percentage: form.type === 'PERCENT' ? Number(form.percentage) : null,
  valueMinor: form.type === 'FIXED' ? Math.round(Number(form.valueNaira) * 100) : null,
  maxDiscountMinor: form.type === 'PERCENT' && Number(form.maxNaira) > 0 ? Math.round(Number(form.maxNaira) * 100) : null,
  minSubtotalMinor: Math.round(Number(form.minNaira || 0) * 100), description: form.description.trim() || null,
  startsAt: new Date(form.startsAt).toISOString(), endsAt: new Date(form.endsAt).toISOString(),
  usageLimit: form.usageLimit === '' ? null : Number(form.usageLimit), perCustomerLimit: Number(form.perCustomerLimit) || 1,
  firstOrderOnly: form.firstOrderOnly, autoApply: form.autoApply, showInApp: form.showInApp, vertical: form.vertical || null, restaurantId: form.restaurantId || null, active: form.active,
})

function PromoForm({ initial, stores, onCancel, onSaved, id }) {
  const [form, setForm] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }))
  const save = async (event) => {
    event.preventDefault(); setBusy(true); setError('')
    try { await call(id ? `/api/admin/promos/${id}` : '/api/admin/promos', { method: id ? 'PUT' : 'POST', body: toBody(form) }); onSaved() } catch (saveError) { setError(saveError.message) } finally { setBusy(false) }
  }
  return <form className="pa-form" onSubmit={save}>
    <div className="pa-grid">
      <label>Name (customers see this)<input required value={form.name} onChange={set('name')} maxLength={80} placeholder="e.g. Weekend treat" /></label>
      <label>Code {form.autoApply ? '(optional)' : ''}<input value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value.toUpperCase().replace(/\s/g, '') }))} maxLength={24} placeholder="e.g. SAPELE10" /></label>
      <label>Type<select value={form.type} onChange={set('type')}><option value="PERCENT">% off the items</option><option value="FIXED">₦ off</option><option value="FREE_DELIVERY">Free delivery</option></select></label>
      {form.type === 'PERCENT' && <label>Percent off<input type="number" min="1" max="100" required value={form.percentage} onChange={set('percentage')} /></label>}
      {form.type === 'PERCENT' && <label>Maximum discount (₦, optional)<input type="number" min="0" value={form.maxNaira} onChange={set('maxNaira')} /></label>}
      {form.type === 'FIXED' && <label>Amount off (₦)<input type="number" min="1" required value={form.valueNaira} onChange={set('valueNaira')} /></label>}
      <label>Minimum basket (₦)<input type="number" min="0" value={form.minNaira} onChange={set('minNaira')} /></label>
      <label>Starts<input type="datetime-local" required value={form.startsAt} onChange={set('startsAt')} /></label>
      <label>Ends<input type="datetime-local" required value={form.endsAt} onChange={set('endsAt')} /></label>
      <label>Uses per customer<input type="number" min="1" max="100" value={form.perCustomerLimit} onChange={set('perCustomerLimit')} /></label>
      <label>Total uses (optional)<input type="number" min="1" value={form.usageLimit} onChange={set('usageLimit')} placeholder="Unlimited" /></label>
      <label>Section<select value={form.vertical} onChange={set('vertical')}>{SECTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Store (optional)<select value={form.restaurantId} onChange={set('restaurantId')}><option value="">Any store</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
    </div>
    <label className="pa-wide">Short description<input value={form.description} onChange={set('description')} maxLength={240} placeholder="e.g. 10% off orders over ₦3,000 this weekend" /></label>
    <div className="pa-checks">
      <label><input type="checkbox" checked={form.firstOrderOnly} onChange={set('firstOrderOnly')} />First order only</label>
      <label><input type="checkbox" checked={form.autoApply} onChange={set('autoApply')} />Apply automatically (no code needed)</label>
      <label><input type="checkbox" checked={form.showInApp} onChange={set('showInApp')} />Show in the app’s offers</label>
      <label><input type="checkbox" checked={form.active} onChange={set('active')} />Active</label>
    </div>
    <p className="pa-hint">DOORSTEP pays the discount from its commission, service fee and delivery fee on that order. If a discount is bigger than that, it is capped automatically so the business is always paid in full.</p>
    {error && <p className="fa-error" role="alert">{error}</p>}
    <div className="pa-actions"><button type="button" className="row-more" onClick={onCancel}><X size={14} /> Cancel</button><button type="submit" className="admin-primary" disabled={busy}>{busy ? 'Saving…' : id ? 'Save changes' : 'Create promo'}</button></div>
  </form>
}

function StoreSections({ stores }) {
  const [rows, setRows] = useState(null)
  const [saved, setSaved] = useState('')
  useEffect(() => { fetch(`${apiBase}/api/app/home`).then((response) => response.ok ? response.json() : null).then((body) => setRows(body?.stores || [])).catch(() => setRows([])) }, [stores.length])
  const update = async (store, patch) => {
    const next = { vertical: patch.vertical ?? store.vertical, pickupEnabled: patch.pickupEnabled ?? store.pickupEnabled }
    try { await call(`/api/admin/restaurants/${store.id}/store-section`, { method: 'PATCH', body: next }); setRows((current) => current.map((row) => row.id === store.id ? { ...row, ...next } : row)); setSaved(store.id); window.setTimeout(() => setSaved(''), 1500) } catch (error) { window.alert(error.message) }
  }
  if (!rows) return null
  return <section className="admin-panel pa-sections">
    <h3><Store size={18} aria-hidden="true" /> Store sections</h3>
    <p className="fa-muted">Choose where each business appears in the customer app, and whether customers may pick up.</p>
    {rows.length === 0 ? <p className="fa-muted">No approved businesses yet.</p> : <ul>{rows.map((store) => <li key={store.id}>
      <b>{store.name}</b>
      <select value={store.vertical} onChange={(event) => update(store, { vertical: event.target.value })} aria-label={`Section for ${store.name}`}>{SECTIONS.slice(1).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <label><input type="checkbox" checked={store.pickupEnabled} onChange={(event) => update(store, { pickupEnabled: event.target.checked })} />Pickup</label>
      {saved === store.id && <Check size={15} aria-label="Saved" />}
    </li>)}</ul>}
  </section>
}

export function PromosAdmin() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const load = useCallback(() => call('/api/admin/promos').then((body) => { setData(body); setError('') }).catch((loadError) => setError(loadError.message)), [])
  useEffect(() => { load() }, [load])
  const toggle = async (promo) => { try { await call(`/api/admin/promos/${promo.id}/active`, { method: 'PATCH', body: { active: !promo.active } }); load() } catch (toggleError) { setError(toggleError.message) } }
  const hasWelcome = data?.promotions.some((promo) => promo.firstOrderOnly && promo.autoApply && promo.active)
  const now = Date.now()
  return <>
    <div className="admin-intro"><div><span className="section-kicker">CUSTOMER APP</span><h2>Promo codes & offers</h2></div></div>
    <p className="fa-muted">Codes customers type at checkout, and automatic offers like free delivery on a first order.</p>
    {error && <p className="fa-error" role="alert">{error}</p>}
    {!editing && <div className="pa-top">
      <button type="button" className="admin-primary" onClick={() => setEditing({ form: blank() })}><Plus size={15} /> New promo code</button>
      {data && !hasWelcome && <button type="button" className="row-more" onClick={() => setEditing({ form: welcome() })}><Gift size={15} /> Set up first-order free delivery</button>}
    </div>}
    {editing && <section className="admin-panel"><h3>{editing.id ? 'Edit promo' : 'New promo'}</h3><PromoForm initial={editing.form} id={editing.id} stores={data?.stores || []} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} /></section>}
    {data && <section className="admin-panel">
      <h3><Tag size={18} aria-hidden="true" /> All promos ({data.promotions.length})</h3>
      {data.promotions.length === 0 ? <p className="fa-muted">No promos yet. Start with first-order free delivery — it’s the most common welcome offer.</p> : <ul className="pa-list">{data.promotions.map((promo) => {
        const live = promo.active && new Date(promo.startsAt).getTime() <= now && new Date(promo.endsAt).getTime() >= now
        return <li key={promo.id} className={live ? 'is-live' : ''}>
          <div className="pa-main"><b>{promo.label}</b><span className="pa-code">{promo.code || 'AUTO'}</span><span className={`pa-state${live ? ' is-live' : ''}`}>{live ? 'Live' : !promo.active ? 'Off' : new Date(promo.endsAt).getTime() < now ? 'Ended' : 'Scheduled'}</span></div>
          <small>{promo.name}{promo.storeName ? ` · ${promo.storeName}` : ''}{promo.vertical ? ` · ${SECTIONS.find(([value]) => value === promo.vertical)?.[1]}` : ''}{promo.firstOrderOnly ? ' · first order' : ''}{promo.minSubtotalMinor ? ` · min ${money(promo.minSubtotalMinor)}` : ''} · {day(promo.startsAt)} – {day(promo.endsAt)}</small>
          <small>Used {promo.used.count}{promo.usageLimit ? ` of ${promo.usageLimit}` : ''} times · DOORSTEP paid {money(promo.used.discountMinor)}</small>
          <div className="pa-row-actions"><button type="button" className="row-more" onClick={() => setEditing({ id: promo.id, form: fromPromo(promo) })}><Pencil size={13} /> Edit</button><button type="button" className="row-more" onClick={() => toggle(promo)}><Power size={13} /> {promo.active ? 'Switch off' : 'Switch on'}</button></div>
        </li>
      })}</ul>}
    </section>}
    {data && <StoreSections stores={data.stores} />}
  </>
}
