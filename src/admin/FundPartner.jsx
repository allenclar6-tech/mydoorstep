import { useEffect, useMemo, useState } from 'react'
import { Bike, Building2, Check, Minus, Plus, RotateCcw, Search, Wallet } from 'lucide-react'
import { apiBase } from '../config/apiBase'

// Admin › Money › Fund a partner: add money to (or take money from) a business's or rider's DOORSTEP balance.
// Shows their balance before and after, asks once to confirm, and allows an immediate undo. The partner can then
// withdraw it from Earnings like any other earnings.

const token = () => { try { return localStorage.getItem('doorstep-admin-token') } catch { return null } }
async function call(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${apiBase}${path}`, { method, headers: { Authorization: `Bearer ${token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Something went wrong. Try again.')
  return data
}
const money = (minor) => `₦${((minor || 0) / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`
const toMinor = (value) => Math.round(Number(String(value).replace(/[^\d.]/g, '')) * 100) || 0
const QUICK = [1_000, 2_000, 5_000, 10_000]
const REASONS = { credit: ['Refund the business covered for a customer', 'Bonus for great service', 'Promotion support', 'Correction of an earlier payout', 'Paid debt for an order'], debit: ['Penalty for a late order', 'Customer refund for a missing item', 'Correction of an over-payment'] }

export function FundPartnerCard({ payees, onDone }) {
  const [query, setQuery] = useState('')
  const [target, setTarget] = useState(null)
  const [direction, setDirection] = useState('credit')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [balance, setBalance] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [last, setLast] = useState(null)

  const everyone = useMemo(() => [
    ...(payees?.restaurants || []).map((entry) => ({ kind: 'business', id: entry.id, name: entry.name })),
    ...(payees?.riders || []).map((entry) => ({ kind: 'rider', id: entry.id, name: entry.name })),
  ], [payees])
  const matches = query.trim() ? everyone.filter((entry) => entry.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8) : []

  useEffect(() => {
    setBalance(null)
    if (!target) return
    call(`/api/admin/finance/payees/${target.kind}/${target.id}`).then((data) => setBalance(data.balance)).catch(() => setBalance({ unavailable: true }))
  }, [target, last])

  const minor = toMinor(amount)
  const signed = direction === 'debit' ? -minor : minor
  const current = balance && !balance.unavailable ? balance.dueMinor ?? balance.availableMinor : null
  const valid = target && minor >= 100 && note.trim().length >= 3

  const submit = async () => {
    setBusy(true); setError('')
    try {
      const body = { amountMinor: signed, note: note.trim(), ...(target.kind === 'rider' ? { riderId: target.id } : { restaurantId: target.id }) }
      await call('/api/admin/finance/adjustments', { method: 'POST', body })
      setLast({ target, signed, note: note.trim() })
      setConfirming(false); setAmount(''); setNote('')
      onDone?.()
    } catch (submitError) { setError(submitError.message) } finally { setBusy(false) }
  }
  const undo = async () => {
    setBusy(true); setError('')
    try {
      await call('/api/admin/finance/adjustments', { method: 'POST', body: { amountMinor: -last.signed, note: `Reversal: ${last.note}`.slice(0, 200), ...(last.target.kind === 'rider' ? { riderId: last.target.id } : { restaurantId: last.target.id }) } })
      setLast(null); onDone?.()
    } catch (undoError) { setError(undoError.message) } finally { setBusy(false) }
  }

  return <section className="fa-card fp" aria-labelledby="fp-title">
    <h3 id="fp-title"><Wallet size={18} aria-hidden="true" />Fund a partner</h3>
    <p className="fa-muted">Add money to a business’s or rider’s DOORSTEP balance (or deduct it). They’re notified with your reason and can withdraw it from Earnings.</p>

    {last && <div className="fp-done" role="status"><Check size={18} aria-hidden="true" /><div><strong>{last.signed > 0 ? `${money(last.signed)} added to ${last.target.name}` : `${money(-last.signed)} deducted from ${last.target.name}`}</strong><small>“{last.note}” · they’ve been notified.</small></div><button type="button" className="row-more" disabled={busy} onClick={undo}><RotateCcw size={14} aria-hidden="true" />Undo</button></div>}

    {!target ? <div className="fp-search">
      <label className="fp-input"><Search size={16} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search a business or rider" aria-label="Search a business or rider" /></label>
      {matches.length > 0 && <ul className="fp-results">{matches.map((entry) => <li key={`${entry.kind}:${entry.id}`}><button type="button" onClick={() => { setTarget(entry); setQuery('') }}>{entry.kind === 'rider' ? <Bike size={15} aria-hidden="true" /> : <Building2 size={15} aria-hidden="true" />}<span>{entry.name}</span><small>{entry.kind === 'rider' ? 'Rider' : 'Business'}</small></button></li>)}</ul>}
      {query.trim() && matches.length === 0 && <p className="fa-muted">No approved business or rider matches “{query}”.</p>}
      {!query.trim() && everyone.length > 0 && <div className="fp-chips">{everyone.slice(0, 6).map((entry) => <button type="button" key={`${entry.kind}:${entry.id}`} onClick={() => setTarget(entry)}>{entry.name}</button>)}</div>}
    </div> : <>
      <div className="fp-who">
        <span className="fp-avatar" aria-hidden="true">{target.kind === 'rider' ? <Bike size={18} /> : <Building2 size={18} />}</span>
        <div><strong>{target.name}</strong><small>{balance == null ? 'Checking balance…' : balance.unavailable ? 'Balance unavailable' : `Balance ${money(current)}${balance.availableMinor != null ? ` · ${money(Math.max(0, balance.availableMinor))} ready to withdraw` : ''}`}</small></div>
        <button type="button" className="row-more" onClick={() => { setTarget(null); setConfirming(false) }}>Change</button>
      </div>

      <div className="fp-toggle" role="radiogroup" aria-label="Add or deduct">
        <button type="button" role="radio" aria-checked={direction === 'credit'} className={direction === 'credit' ? 'is-on' : ''} onClick={() => setDirection('credit')}><Plus size={15} aria-hidden="true" />Add money</button>
        <button type="button" role="radio" aria-checked={direction === 'debit'} className={direction === 'debit' ? 'is-on is-debit' : ''} onClick={() => setDirection('debit')}><Minus size={15} aria-hidden="true" />Deduct</button>
      </div>

      <label className="fp-amount"><span>₦</span><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^\d.,]/g, ''))} placeholder="0" aria-label="Amount in naira" /></label>
      <div className="fp-chips">{QUICK.map((value) => <button type="button" key={value} onClick={() => setAmount(String(value))}>{money(value * 100)}</button>)}</div>

      <label className="fp-note">Reason (they will see this)<input value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Paid debt for today’s order" /></label>
      <div className="fp-chips is-reasons">{REASONS[direction].map((reason) => <button type="button" key={reason} onClick={() => setNote(reason)}>{reason}</button>)}</div>

      {current != null && minor > 0 && <p className="fp-preview">Balance {money(current)} → <b>{money(current + signed)}</b></p>}
      {error && <p className="fa-error" role="alert">{error}</p>}
      {!confirming
        ? <button type="button" className="admin-primary fp-go" disabled={!valid} onClick={() => setConfirming(true)}>{direction === 'debit' ? `Deduct ${minor ? money(minor) : ''}` : `Add ${minor ? money(minor) : 'money'}`}</button>
        : <div className="fp-confirm"><p>{direction === 'debit' ? 'Deduct' : 'Add'} <b>{money(minor)}</b> {direction === 'debit' ? 'from' : 'to'} <b>{target.name}</b>?</p><div><button type="button" className="row-more" onClick={() => setConfirming(false)}>Back</button><button type="button" className="admin-primary" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Yes, confirm'}</button></div></div>}
    </>}
  </section>
}
