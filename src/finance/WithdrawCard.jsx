import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, CalendarClock, Check, CircleAlert, Clock3, HandCoins, Landmark, Truck, X, Zap } from 'lucide-react'
import { apiBase } from '../config/apiBase'

// Withdraw, for businesses and riders: choose any amount up to what's ready (or tap 25% / 50% / 75% / All),
// see the fee and exactly what reaches the bank, confirm, then follow it until it lands. Money still on hold
// shows when it becomes withdrawable. Instant when DOORSTEP has Paystack Transfers on; otherwise DOORSTEP
// approves and sends it.

const readToken = () => { try { return localStorage.getItem('doorstep-token') } catch { return null } }
async function call(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${apiBase}${path}`, { method, headers: { Authorization: `Bearer ${readToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Something went wrong. Try again.')
  return data
}
const money = (minor) => `₦${((minor || 0) / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`
const when = (value) => new Date(value).toLocaleString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const soon = (value) => {
  const ms = new Date(value).getTime() - Date.now()
  if (ms <= 60_000) return 'any moment now'
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.round((ms % 3_600_000) / 60_000)
  return hours ? `in ${hours} h ${minutes} min` : `in ${minutes} min`
}
const toMinor = (text) => { const value = Number(String(text).replace(/,/g, '')); return Number.isFinite(value) ? Math.round(value * 100) : 0 }
const feeFor = (amountMinor, fee) => amountMinor > 0 ? fee.flatMinor + Math.round(amountMinor * fee.percent / 100) : 0
const nairaInput = (minor) => String(Math.floor(minor / 100))

const BLOCKED = {
  NO_ACCOUNT: 'Add your bank account to withdraw.',
  DAILY_LIMIT: 'You’ve used today’s withdrawals. You can withdraw again tomorrow.',
}

function Tracker({ request }) {
  const steps = [['Requested', true], [request.status === 'REQUESTED' ? 'DOORSTEP sends it' : 'Sent', request.status !== 'REQUESTED'], ['In your bank', false]]
  const now = steps.findIndex(([, done]) => !done)
  return <ol className="wd-track" aria-label="Withdrawal progress">{steps.map(([label, done], index) => <li key={label} className={done ? 'is-done' : index === now ? 'is-now' : ''}><span>{done ? <Check size={12} aria-hidden="true" /> : index + 1}</span>{label}</li>)}</ol>
}

/** Money still on hold, and when it becomes withdrawable. */
function Clearing({ options }) {
  if (!options.heldMinor) return null
  return <div className="wd-clearing">
    <p className="wd-clearing-title"><Clock3 size={15} aria-hidden="true" />{money(options.heldMinor)} is clearing{options.holdHours ? ` (${options.holdHours}-hour safety window)` : ''}</p>
    <ul>
      {options.releases?.map((release) => <li key={release.at}><CalendarClock size={14} aria-hidden="true" /><span><b>{money(release.amountMinor)}</b> ready {soon(release.at)}</span><small>{when(release.at)}</small></li>)}
      {options.awaitingDeliveryMinor > 0 && <li><Truck size={14} aria-hidden="true" /><span><b>{money(options.awaitingDeliveryMinor)}</b> once orders are delivered</span></li>}
    </ul>
  </div>
}

/** `onAddAccount` opens the bank-account form; `onChanged` refreshes the rest of Earnings. */
export function WithdrawCard({ onAddAccount, onChanged }) {
  const [options, setOptions] = useState(null)
  const [error, setError] = useState('')
  const [amount, setAmount] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const touched = useRef(false)
  const load = useCallback(() => call('/api/finance/withdrawal-options').then((data) => {
    setOptions(data); setError('')
    if (!touched.current) setAmount(data.availableMinor >= data.minimumMinor ? nairaInput(data.availableMinor) : '')
  }).catch((loadError) => setError(loadError.message)), [])
  useEffect(() => { load(); const timer = window.setInterval(() => { if (!document.hidden) load() }, 60_000); return () => window.clearInterval(timer) }, [load])

  if (error && !options) return <section className="wd-card"><p className="wd-error" role="alert">{error}</p><button type="button" className="wd-ghost" onClick={load}>Try again</button></section>
  if (!options) return <section className="wd-card is-loading" aria-busy="true"><p>Checking what you can withdraw…</p></section>

  const instant = options.mode === 'INSTANT'
  const open = options.openRequest
  const available = options.availableMinor
  const minor = toMinor(amount)
  const fee = feeFor(minor, options.fee)
  const receive = Math.max(0, minor - fee)
  const left = Math.max(0, available - minor)
  const problem = !minor ? 'Enter an amount.'
    : minor < options.minimumMinor ? `The minimum is ${money(options.minimumMinor)}.`
      : minor > available ? `You can withdraw up to ${money(available)} right now.`
        : receive < 100 ? 'That’s too small to cover the fee.' : ''
  const canWithdraw = !['NO_ACCOUNT', 'DAILY_LIMIT', 'OPEN_REQUEST'].includes(options.blocked) && available >= options.minimumMinor
  const chips = [[25, '25%'], [50, '50%'], [75, '75%'], [100, 'All']].map(([percent, label]) => [label, Math.floor(available * percent / 100 / 100) * 100]).filter(([, value], index, list) => value >= options.minimumMinor && list.findIndex(([, other]) => other === value) === index)

  const submit = async () => {
    setBusy(true); setError('')
    try {
      const data = await call('/api/finance/withdrawal-requests', { method: 'POST', body: { amountMinor: minor } })
      const status = data.request.status
      if (status === 'FAILED') throw new Error('Paystack couldn’t send it, so nothing left your balance. Try again in a few minutes.')
      setDone({ instant: data.request.instant, amountMinor: data.request.amountMinor, paid: status === 'PAID' })
      setConfirming(false); touched.current = false; load(); onChanged?.()
    } catch (submitError) { setError(submitError instanceof TypeError ? 'No connection. Nothing was withdrawn — try again.' : submitError.message) } finally { setBusy(false) }
  }
  const cancel = async () => {
    setBusy(true); setError('')
    try { await call(`/api/finance/withdrawal-requests/${open.id}/cancel`, { method: 'POST' }); setDone(null); load(); onChanged?.() } catch (cancelError) { setError(cancelError.message) } finally { setBusy(false) }
  }
  const feeText = options.fee.flatMinor || options.fee.percent ? `${options.fee.flatMinor ? money(options.fee.flatMinor) : ''}${options.fee.flatMinor && options.fee.percent ? ' + ' : ''}${options.fee.percent ? `${options.fee.percent}%` : ''} fee` : 'No fee'

  return <section className="wd-card" aria-labelledby="wd-title">
    <div className="wd-top">
      <span className="wd-label" id="wd-title">{open ? 'Withdrawal on its way' : 'Withdraw'}</span>
      <span className={`wd-mode${instant ? ' is-instant' : ''}`}>{instant ? <><Zap size={13} aria-hidden="true" />Instant</> : <><Clock3 size={13} aria-hidden="true" />Approved by DOORSTEP</>}</span>
    </div>

    {!open && <div className="wd-tiles">
      <div className="is-ready"><small>Ready to withdraw</small><strong>{money(available)}</strong></div>
      <div><small>Clearing</small><strong>{money(options.heldMinor)}</strong></div>
    </div>}

    {done && <p className="wd-ok" role="status"><Check size={16} aria-hidden="true" />{done.instant ? (done.paid ? `${money(done.amountMinor)} is on its way to your bank.` : `${money(done.amountMinor)} is being sent. We’ll notify you when your bank confirms.`) : `Request sent for ${money(done.amountMinor)}. DOORSTEP has been notified and will send it shortly.`}</p>}

    {open && <>
      <strong className="wd-amount">{money(open.amountMinor)}</strong>
      <Tracker request={open} />
      <p className="wd-note">Requested {when(open.createdAt)}{open.feeMinor ? ` · fee ${money(open.feeMinor)}` : ''}. {open.status === 'REQUESTED' ? 'DOORSTEP sends withdrawals during working hours, usually the same day. You’ll get a notification when it’s sent.' : 'It’s being sent to your bank now.'}</p>
      {open.status === 'REQUESTED' && <button type="button" className="wd-ghost" disabled={busy} onClick={cancel}><X size={15} aria-hidden="true" />{busy ? 'Cancelling…' : 'Cancel request'}</button>}
    </>}

    {!open && !confirming && <>
      {options.blocked === 'NO_ACCOUNT' ? <>
        <p className="wd-blocked"><CircleAlert size={15} aria-hidden="true" />{BLOCKED.NO_ACCOUNT}</p>
        <button type="button" className="wd-primary" onClick={onAddAccount}><Landmark size={16} aria-hidden="true" />Add bank account</button>
      </> : options.blocked === 'DAILY_LIMIT' ? <p className="wd-blocked"><CircleAlert size={15} aria-hidden="true" />{BLOCKED.DAILY_LIMIT}</p> : canWithdraw ? <>
        <label className="wd-input">
          <span>How much?</span>
          <div><b aria-hidden="true">₦</b><input inputMode="numeric" value={amount} placeholder="0" aria-describedby="wd-hint" onChange={(event) => { touched.current = true; setAmount(event.target.value.replace(/[^\d.]/g, '')) }} /></div>
        </label>
        {chips.length > 0 && <div className="wd-chips">{chips.map(([label, value]) => <button type="button" key={label} className={minor === value ? 'is-on' : ''} onClick={() => { touched.current = true; setAmount(nairaInput(value)) }}>{label}</button>)}</div>}
        <dl className="wd-sum" id="wd-hint">
          <div><dt>{feeText}</dt><dd>{fee ? `−${money(fee)}` : '₦0'}</dd></div>
          <div className="is-total"><dt>You receive</dt><dd>{money(receive)}</dd></div>
          {minor > 0 && minor <= available && <div><dt>Left in your balance</dt><dd>{money(left)}</dd></div>}
        </dl>
        {problem && amount !== '' && <p className="wd-hint-bad">{problem}</p>}
        <p className="wd-to"><Landmark size={15} aria-hidden="true" />To {options.account?.bankName} ••••{options.account?.last4} · {options.account?.accountName}</p>
        <button type="button" className="wd-primary" disabled={Boolean(problem)} onClick={() => { setDone(null); setError(''); setConfirming(true) }}><HandCoins size={17} aria-hidden="true" />Withdraw {minor ? money(minor) : ''}</button>
      </> : <>
        <p className="wd-blocked is-soft">{available > 0 ? `You can withdraw once ${money(options.minimumMinor)} is ready — ${money(options.minimumMinor - available)} to go.` : options.heldMinor > 0 ? 'Nothing is ready yet. Your money below becomes withdrawable soon.' : 'Nothing to withdraw yet. Your earnings appear here as orders are delivered.'}</p>
        <button type="button" className="wd-primary" disabled><HandCoins size={17} aria-hidden="true" />Withdraw</button>
      </>}
      <Clearing options={options} />
      <p className="wd-small">Minimum {money(options.minimumMinor)} · {options.remainingToday} withdrawal{options.remainingToday === 1 ? '' : 's'} left today</p>
    </>}

    {!open && confirming && <div className="wd-confirm" role="group" aria-label="Confirm withdrawal">
      <p className="wd-confirm-title">Confirm withdrawal</p>
      <dl>
        <div><dt>Withdraw</dt><dd>{money(minor)}</dd></div>
        <div><dt>Fee</dt><dd>{fee ? `−${money(fee)}` : 'Free'}</dd></div>
        <div className="is-total"><dt>To your bank</dt><dd>{money(receive)}</dd></div>
      </dl>
      <p className="wd-to"><Landmark size={15} aria-hidden="true" />{options.account?.bankName} ••••{options.account?.last4} · {options.account?.accountName}</p>
      <p className="wd-small">{instant ? 'Sent by Paystack straight away. Most banks credit within minutes.' : 'DOORSTEP approves and sends it, usually the same working day. You can cancel until it’s sent.'}</p>
      <div className="wd-actions"><button type="button" className="wd-ghost" disabled={busy} onClick={() => setConfirming(false)}>Back</button><button type="button" className="wd-primary" disabled={busy} onClick={submit}><ArrowUpRight size={16} aria-hidden="true" />{busy ? 'Working…' : instant ? `Send ${money(receive)}` : `Request ${money(receive)}`}</button></div>
    </div>}
    {error && <p className="wd-error" role="alert">{error}</p>}
  </section>
}
