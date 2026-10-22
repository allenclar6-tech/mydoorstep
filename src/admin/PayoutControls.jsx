import { useEffect, useState } from 'react'
import { Bike, Building2, CalendarClock, HandCoins, Percent, Save, Send, Wallet, Zap } from 'lucide-react'
import { apiBase } from '../config/apiBase'

// Admin → Money → Payouts: how businesses and riders get paid (Glovo-style automatic, scheduled or manual
// payouts and self-service cash-outs), manual credits/debits, and negotiated commission per business.

const token = () => { try { return localStorage.getItem('doorstep-admin-token') } catch { return null } }
async function call(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${apiBase}${path}`, { method, headers: { Authorization: `Bearer ${token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Something went wrong. Try again.')
  return data
}
const money = (minor) => `₦${((minor || 0) / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`
const toMinor = (naira) => Math.round(Number(naira || 0) * 100)
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MODES = [
  ['AUTOMATIC', 'Automatic', Zap, 'Paid as soon as the money clears'],
  ['SCHEDULED', 'Scheduled', CalendarClock, 'Paid together on a timetable'],
  ['MANUAL', 'Manual', HandCoins, 'You pay from “To pay out”'],
]
const when = (value) => value ? new Date(value).toLocaleString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : null

function RuleEditor({ title, icon: Icon, rule, onChange, next, holdHint }) {
  const set = (patch) => onChange({ ...rule, ...patch })
  return <fieldset className="fa-bands po-rule">
    <legend><Icon size={15} aria-hidden="true" /> {title}</legend>
    <div className="po-modes" role="radiogroup" aria-label={`${title} payout mode`}>
      {MODES.map(([value, label, ModeIcon, hint]) => <button type="button" role="radio" aria-checked={rule.mode === value} key={value} className={rule.mode === value ? 'is-on' : ''} onClick={() => set({ mode: value })}>
        <ModeIcon size={16} aria-hidden="true" /><b>{label}</b><small>{hint}</small>
      </button>)}
    </div>
    {rule.mode === 'SCHEDULED' && <div className="fa-grid">
      <label>How often<select value={rule.frequency} onChange={(event) => set({ frequency: event.target.value })}><option value="WEEKLY">Weekly</option><option value="DAILY">Daily</option></select></label>
      {rule.frequency === 'WEEKLY' && <label>Day<select value={rule.weekday} onChange={(event) => set({ weekday: Number(event.target.value) })}>{WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>}
      <label>Time (Lagos)<select value={rule.hour} onChange={(event) => set({ hour: Number(event.target.value) })}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}</select></label>
    </div>}
    {rule.mode !== 'MANUAL' && <div className="fa-grid">
      <label>Hold before paying (hours)<input type="number" min="0" max="336" step="1" value={rule.holdHours} onChange={(event) => set({ holdHours: Number(event.target.value || 0) })} /><small className="fa-muted">{holdHint}</small></label>
      <label>Smallest payout (₦)<input type="number" min="1" step="50" value={rule.minimumMinor / 100} onChange={(event) => set({ minimumMinor: Math.max(100, toMinor(event.target.value)) })} /><small className="fa-muted">Smaller balances roll over to the next payout.</small></label>
    </div>}
    {rule.mode === 'SCHEDULED' && next && <p className="fa-muted">Next run: <b>{when(next)}</b></p>}
  </fieldset>
}

export function PayoutSettingsCard({ onChanged }) {
  const [form, setForm] = useState(null)
  const [transfersEnabled, setTransfersEnabled] = useState(false)
  const [next, setNext] = useState({})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState('')
  const load = () => call('/api/admin/finance/payout-settings').then((data) => { setForm(data.settings); setTransfersEnabled(data.transfersEnabled); setNext(data.next || {}) }).catch((error) => setMessage(error.message))
  useEffect(() => { load() }, [])
  if (!form) return <section className="fa-card"><p className="fa-muted">{message || 'Loading payout settings…'}</p></section>
  const withdrawals = form.withdrawals
  const setWithdrawals = (patch) => setForm({ ...form, withdrawals: { ...withdrawals, ...patch } })
  const save = async (event) => {
    event.preventDefault()
    setBusy('save'); setMessage('')
    try {
      await call('/api/admin/finance/payout-settings', { method: 'PUT', body: form })
      await load()
      setMessage(transfersEnabled ? 'Saved. Payouts follow these rules from now on.' : 'Saved. Automatic payouts and cash-outs start once Paystack Transfers are turned on.')
      onChanged?.()
    } catch (error) { setMessage(error.message) } finally { setBusy('') }
  }
  const payEveryone = async () => {
    if (!window.confirm('Send every business and rider their cleared balance by Paystack Transfer now?')) return
    setBusy('run'); setMessage('')
    try {
      const { results } = await call('/api/admin/finance/payouts/run', { method: 'POST', body: { party: 'ALL' } })
      const parts = Object.entries(results).map(([party, summary]) => `${party === 'RIDER' ? 'Riders' : 'Businesses'}: ${summary.paid} paid (${money(summary.paidMinor)})${summary.processing ? `, ${summary.processing} processing` : ''}${summary.skipped.length ? `, ${summary.skipped.length} skipped` : ''}`)
      setMessage(parts.join(' · '))
      onChanged?.()
    } catch (error) { setMessage(error.message) } finally { setBusy('') }
  }
  const example = 1_000_000
  const exampleFee = withdrawals.feeMinor + Math.round(example * withdrawals.feePercent / 100)
  return <form className="fa-card fa-settings" onSubmit={save}>
    <div className="po-head"><h3><Wallet size={17} aria-hidden="true" /> Payouts</h3>
      <button type="button" className="admin-primary" disabled={!transfersEnabled || busy === 'run'} onClick={payEveryone}><Send size={14} /> {busy === 'run' ? 'Paying…' : 'Pay everyone now'}</button>
    </div>
    {!transfersEnabled && <div className="po-banner"><b>Paystack Transfers are off.</b> Automatic, scheduled and cash-out payouts wait until Transfers are on in Paystack and PAYSTACK_TRANSFERS_ENABLED=true is set on the API. Until then you can still record bank payments under “To pay out”.</div>}
    <p className="fa-muted">Card payments with a business payout account are split by Paystack at checkout. Everything else (bank transfers, saved cards, rider pay, adjustments) is paid from your Paystack balance using these rules.</p>
    <RuleEditor title="Businesses" icon={Building2} rule={form.businesses} next={next.RESTAURANT} onChange={(businesses) => setForm({ ...form, businesses })} holdHint="Order money also waits until the order is delivered." />
    <RuleEditor title="Riders" icon={Bike} rule={form.riders} next={next.RIDER} onChange={(riders) => setForm({ ...form, riders })} holdHint="Rider pay is earned when the delivery is completed." />
    <fieldset className="fa-bands">
      <legend><HandCoins size={15} aria-hidden="true" /> Cash out now</legend>
      <label className="fa-switch"><input type="checkbox" checked={withdrawals.enabled} onChange={(event) => setWithdrawals({ enabled: event.target.checked })} /> Let businesses and riders withdraw their cleared balance any time</label>
      {withdrawals.enabled && <div className="fa-grid">
        <label>Flat fee (₦)<input type="number" min="0" step="10" value={withdrawals.feeMinor / 100} onChange={(event) => setWithdrawals({ feeMinor: toMinor(event.target.value) })} /></label>
        <label>Plus % of the amount<input type="number" min="0" max="10" step="0.1" value={withdrawals.feePercent} onChange={(event) => setWithdrawals({ feePercent: Number(event.target.value || 0) })} /></label>
        <label>Smallest cash-out (₦)<input type="number" min="1" step="50" value={withdrawals.minimumMinor / 100} onChange={(event) => setWithdrawals({ minimumMinor: Math.max(100, toMinor(event.target.value)) })} /></label>
        <label>Cash-outs per day<input type="number" min="1" max="10" step="1" value={withdrawals.perDay} onChange={(event) => setWithdrawals({ perDay: Number(event.target.value || 1) })} /></label>
      </div>}
      {withdrawals.enabled && <p className="fa-muted">Example: cashing out {money(example)} costs {money(exampleFee)}; they receive {money(example - exampleFee)}. The fee is DOORSTEP income.</p>}
    </fieldset>
    {message && <p className="fa-muted" role="status">{message}</p>}
    <button type="submit" className="admin-primary" disabled={busy === 'save'}><Save size={14} /> {busy === 'save' ? 'Saving…' : 'Save payout rules'}</button>
  </form>
}

/** Manual credit or debit on a business's or rider's balance. */
export function AdjustmentCard({ payees, onDone }) {
  const [target, setTarget] = useState('')
  const [direction, setDirection] = useState('credit')
  const [naira, setNaira] = useState('')
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event) => {
    event.preventDefault()
    const [kind, id] = target.split(':')
    const amountMinor = toMinor(naira) * (direction === 'debit' ? -1 : 1)
    setBusy(true); setMessage('')
    try {
      await call('/api/admin/finance/adjustments', { method: 'POST', body: { [kind === 'rider' ? 'riderId' : 'restaurantId']: id, amountMinor, note } })
      setMessage(`${direction === 'debit' ? 'Deducted' : 'Added'} ${money(Math.abs(amountMinor))}. They were notified.`)
      setNaira(''); setNote('')
      onDone?.()
    } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }
  return <form className="fa-card fa-settings" onSubmit={submit}>
    <h3>Credit or debit a balance</h3>
    <p className="fa-muted">For anything the rules don’t cover: a refund a business paid for, a bonus, a penalty. It joins their next payout.</p>
    <div className="fa-grid">
      <label>Who<select required value={target} onChange={(event) => setTarget(event.target.value)}>
        <option value="">Choose a business or rider</option>
        {payees?.restaurants.length > 0 && <optgroup label="Businesses">{payees.restaurants.map((entry) => <option key={entry.id} value={`restaurant:${entry.id}`}>{entry.name}</option>)}</optgroup>}
        {payees?.riders.length > 0 && <optgroup label="Riders">{payees.riders.map((entry) => <option key={entry.id} value={`rider:${entry.id}`}>{entry.name}</option>)}</optgroup>}
      </select></label>
      <label>Type<select value={direction} onChange={(event) => setDirection(event.target.value)}><option value="credit">Credit (add money)</option><option value="debit">Debit (deduct money)</option></select></label>
      <label>Amount (₦)<input required type="number" min="1" step="1" value={naira} onChange={(event) => setNaira(event.target.value)} /></label>
    </div>
    <label>Reason (they will see this)<input required minLength={3} maxLength={200} value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Refund for missing item on DSP-…" /></label>
    {message && <p className="fa-muted" role="status">{message}</p>}
    <button type="submit" className="admin-primary" disabled={busy || !target || !naira}>{busy ? 'Saving…' : direction === 'debit' ? 'Deduct' : 'Add credit'}</button>
  </form>
}

function CommissionRow({ entry, platform, onSaved }) {
  const [doorstep, setDoorstep] = useState(entry.doorstepRiderPercent ?? '')
  const [own, setOwn] = useState(entry.ownRiderPercent ?? '')
  const [state, setState] = useState('')
  const dirty = String(doorstep) !== String(entry.doorstepRiderPercent ?? '') || String(own) !== String(entry.ownRiderPercent ?? '')
  const save = async () => {
    setState('saving')
    try {
      await call(`/api/admin/finance/restaurants/${entry.id}/commission`, { method: 'PUT', body: { doorstepRiderPercent: doorstep === '' ? null : Number(doorstep), ownRiderPercent: own === '' ? null : Number(own) } })
      setState('saved'); onSaved?.()
    } catch (error) { setState(error.message) }
  }
  return <li className="fa-owed po-commission">
    <span className="fa-owed-main"><strong>{entry.name}</strong>{state && state !== 'saving' && <small className={state === 'saved' ? '' : 'fa-error'}>{state === 'saved' ? 'Saved — applies to new orders' : state}</small>}</span>
    <label>DOORSTEP rider %<input type="number" min="0" max="50" step="0.5" value={doorstep} placeholder={String(platform.doorstepRiderPercent)} onChange={(event) => setDoorstep(event.target.value)} /></label>
    <label>Own rider %<input type="number" min="0" max="50" step="0.5" value={own} placeholder={String(platform.ownRiderPercent)} onChange={(event) => setOwn(event.target.value)} /></label>
    <button type="button" className="row-more" disabled={!dirty || state === 'saving'} onClick={save}>Save</button>
  </li>
}

/** Negotiated commission per business; empty fields use the platform rate. */
export function CommissionCard({ payees, platform, onSaved }) {
  const [query, setQuery] = useState('')
  if (!payees || !platform) return null
  const shown = payees.restaurants.filter((entry) => entry.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 30)
  return <section className="fa-card fa-settings">
    <h3><Percent size={16} aria-hidden="true" /> Commission per business</h3>
    <p className="fa-muted">Leave a field empty to use the standard {platform.doorstepRiderPercent}% / {platform.ownRiderPercent}%. Changes apply to new orders only.</p>
    {payees.restaurants.length > 8 && <label>Find a business<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Type a name" /></label>}
    {payees.restaurants.length === 0 ? <p className="fa-muted">No approved businesses yet.</p> : <ul className="fa-list">{shown.map((entry) => <CommissionRow key={entry.id} entry={entry} platform={platform} onSaved={onSaved} />)}</ul>}
  </section>
}
