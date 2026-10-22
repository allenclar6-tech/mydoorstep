import { useCallback, useEffect, useState } from 'react'
import { Bike, Building2, Check, CheckCircle2, CircleAlert, Copy, Landmark, Phone, RefreshCw, Send, X, Zap } from 'lucide-react'
import { apiBase } from '../config/apiBase'

// Admin › Money: partners' withdrawal requests, plus a checklist for paying partners straight to their bank.

const token = () => { try { return localStorage.getItem('doorstep-admin-token') } catch { return null } }
async function call(path, { method = 'GET', body, form } = {}) {
  const response = await fetch(`${apiBase}${path}`, { method, headers: { Authorization: `Bearer ${token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: form || (body ? JSON.stringify(body) : undefined) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Something went wrong. Try again.')
  return data
}
const money = (minor) => `₦${((minor || 0) / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`
const ago = (value) => { const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000)); return minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} days ago` }

function CopyButton({ value, label }) {
  const [done, setDone] = useState(false)
  if (!value) return null
  return <button type="button" className="wq-copy" onClick={() => navigator.clipboard.writeText(String(value)).then(() => { setDone(true); window.setTimeout(() => setDone(false), 1800) }).catch(() => undefined)} aria-label={`Copy ${label}`}>{done ? <Check size={13} /> : <Copy size={13} />}{done ? 'Copied' : 'Copy'}</button>
}

function RequestRow({ request, transfersEnabled, onDone }) {
  const [mode, setMode] = useState(null)
  const [reference, setReference] = useState('')
  const [file, setFile] = useState(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const act = async (fn) => { setBusy(true); setError(''); try { await fn(); onDone() } catch (actError) { setError(actError.message) } finally { setBusy(false) } }
  const markPaid = () => act(async () => {
    await call(`/api/admin/finance/withdrawal-requests/${request.id}/paid`, { method: 'POST', body: { bankReference: reference } })
    if (file) { const form = new FormData(); form.append('receipt', file); await call(`/api/admin/finance/payouts/${request.id}/receipt`, { method: 'POST', form }).catch(() => undefined) }
  })
  const bank = request.bank || {}
  return <li className="wq-row">
    <div className="wq-head">
      <span className="wq-icon" aria-hidden="true">{request.party === 'RIDER' ? <Bike size={16} /> : <Building2 size={16} />}</span>
      <div><strong>{request.name}</strong><small>{request.party === 'RIDER' ? 'Rider' : 'Business'} · requested {ago(request.createdAt)}{request.phone ? <> · <a href={`tel:${request.phone}`}><Phone size={11} aria-hidden="true" /> {request.phone}</a></> : null}</small></div>
      <b className="wq-amount">{money(request.amountMinor)}<small>{request.feeMinor ? `fee ${money(request.feeMinor)} kept` : 'no fee'}</small></b>
    </div>
    <dl className="wq-bank">
      <div><dt>Bank</dt><dd>{bank.bankName || '—'}</dd></div>
      <div><dt>Account number</dt><dd>{bank.accountNumber || `••••${bank.last4 || ''}`}<CopyButton value={bank.accountNumber} label="account number" /></dd></div>
      <div><dt>Account name</dt><dd>{bank.accountName || '—'}</dd></div>
      <div><dt>Send exactly</dt><dd>{money(request.amountMinor)}<CopyButton value={request.amountMinor / 100} label="amount" /></dd></div>
    </dl>
    {!bank.accountNumber && <p className="wq-warn"><CircleAlert size={14} aria-hidden="true" />Paystack didn’t return the full account number. Call the partner to confirm it before sending.</p>}
    {!mode && <div className="wq-actions">
      {transfersEnabled && <button type="button" className="wq-primary" disabled={busy} onClick={() => act(() => call(`/api/admin/finance/withdrawal-requests/${request.id}/send`, { method: 'POST' }))}><Zap size={15} aria-hidden="true" />{busy ? 'Sending…' : 'Send by Paystack'}</button>}
      <button type="button" className={transfersEnabled ? 'wq-ghost' : 'wq-primary'} onClick={() => setMode('paid')}><Landmark size={15} aria-hidden="true" />I paid it from my bank</button>
      <button type="button" className="wq-ghost is-danger" onClick={() => setMode('decline')}><X size={15} aria-hidden="true" />Decline</button>
    </div>}
    {mode === 'paid' && <div className="wq-form">
      <p className="wq-hint">Send {money(request.amountMinor)} to the account above from your bank app, then enter the transaction / session ID. The partner is asked to confirm it arrived.</p>
      <label>Bank transaction / session ID<input value={reference} maxLength={160} onChange={(event) => setReference(event.target.value)} placeholder="e.g. 100004241022163000123456789" /></label>
      <label>Receipt (optional)<input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>
      <div className="wq-actions"><button type="button" className="wq-primary" disabled={busy || reference.trim().length < 3} onClick={markPaid}><Send size={15} aria-hidden="true" />{busy ? 'Saving…' : 'Mark as sent'}</button><button type="button" className="wq-ghost" onClick={() => setMode(null)}>Back</button></div>
    </div>}
    {mode === 'decline' && <div className="wq-form">
      <label>Why? (the partner sees this)<input value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Bank details don’t match — please update them" /></label>
      <div className="wq-actions"><button type="button" className="wq-primary is-danger" disabled={busy || reason.trim().length < 3} onClick={() => act(() => call(`/api/admin/finance/withdrawal-requests/${request.id}/decline`, { method: 'POST', body: { reason } }))}>{busy ? 'Saving…' : 'Decline and return the money'}</button><button type="button" className="wq-ghost" onClick={() => setMode(null)}>Back</button></div>
    </div>}
    {error && <p className="fa-error" role="alert">{error}</p>}
  </li>
}

export function WithdrawalQueue({ onChanged }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(() => call('/api/admin/finance/withdrawal-requests').then((body) => { setData(body); setError('') }).catch((loadError) => setError(loadError.message)), [])
  useEffect(() => { load(); const timer = window.setInterval(load, 30_000); return () => window.clearInterval(timer) }, [load])
  if (!data && !error) return null
  if (data && data.requests.length === 0) return null
  return <section className="fa-card wq" aria-labelledby="wq-title">
    <div className="wq-title"><h3 id="wq-title">Withdrawal requests {data ? `(${data.requests.length})` : ''}</h3><button type="button" className="row-more" onClick={load}><RefreshCw size={14} /> Refresh</button></div>
    <p className="fa-muted">The money is already set aside from their balance. Send it, then record it — or decline and it goes back to their balance with no fee.</p>
    {error && <p className="fa-error">{error}</p>}
    <ul className="wq-list">{data?.requests.map((request) => <RequestRow key={request.id} request={request} transfersEnabled={data.transfersEnabled} onDone={() => { load(); onChanged?.() }} />)}</ul>
  </section>
}

/** Checklist: can DOORSTEP pay partners straight to their bank right now? */
export function PayoutReadiness() {
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(false)
  useEffect(() => { call('/api/admin/finance/payout-readiness').then(setData).catch(() => setData(null)) }, [])
  if (!data) return null
  const low = data.balance?.balanceMinor != null && data.balance.balanceMinor < data.owedMinor
  const checks = [
    [data.paystackKey, 'Paystack secret key on Render', 'Add the Paystack secret key in Render → API service → Environment.'],
    [data.transfersEnabled, 'Paystack Transfers switched on', 'In your Paystack dashboard, make sure Transfers (payouts) are available for your business — Paystack may ask for business verification first. Then on Render set PAYSTACK_TRANSFERS_ENABLED=true and redeploy.'],
    [data.balance?.balanceMinor != null && !low, data.balance?.balanceMinor != null ? `Paystack balance ${money(data.balance.balanceMinor)}${data.owedMinor ? ` · owed to partners ${money(data.owedMinor)}` : ''}` : 'Paystack balance', data.balance?.error ? `Couldn’t read the balance: ${data.balance.error}` : low ? 'Top up your Paystack balance (Paystack → Balance → Top up) so every payout can be sent.' : 'Card payments land here; payouts are sent from it.'],
    [data.accounts.businessAccounts >= data.accounts.businesses && data.accounts.riderAccounts >= data.accounts.riders, `Bank accounts: ${data.accounts.businessAccounts}/${data.accounts.businesses} businesses · ${data.accounts.riderAccounts}/${data.accounts.riders} riders`, 'Partners add theirs in Earnings → Add bank account. Paystack checks the name.'],
    [data.withdrawals.enabled, 'Partners can withdraw', 'Turn on “Cash out now” in Payout rules below. Without Paystack Transfers, withdrawals arrive here as requests.'],
    [data.modes.businesses !== 'MANUAL' || data.modes.riders !== 'MANUAL', `Payout mode: businesses ${data.modes.businesses.toLowerCase()}, riders ${data.modes.riders.toLowerCase()}`, 'Choose Automatic (paid as soon as money clears) or Scheduled (daily/weekly) in Payout rules for hands-free payouts.'],
  ]
  const ready = data.paystackKey && data.transfersEnabled
  return <section className={`fa-card pr${ready ? ' is-ready' : ''}`}>
    <button type="button" className="pr-head" onClick={() => setOpen(!open)} aria-expanded={open}>
      {ready ? <CheckCircle2 size={20} aria-hidden="true" /> : <CircleAlert size={20} aria-hidden="true" />}
      <span><strong>{ready ? 'Partners are paid straight to their bank' : 'Direct-to-bank payouts aren’t switched on yet'}</strong><small>{ready ? `Paystack Transfers on${data.balance?.balanceMinor != null ? ` · balance ${money(data.balance.balanceMinor)}` : ''}${low ? ' · balance too low!' : ''}` : 'Withdrawals come to you as requests until Paystack Transfers is on. Tap to see the steps.'}</small></span>
    </button>
    {open && <ol className="pr-list">{checks.map(([ok, title, help]) => <li key={title} className={ok ? 'is-ok' : 'is-todo'}><span aria-hidden="true">{ok ? <Check size={13} /> : '!'}</span><div><b>{title}</b>{!ok && <small>{help}</small>}</div></li>)}</ol>}
  </section>
}
