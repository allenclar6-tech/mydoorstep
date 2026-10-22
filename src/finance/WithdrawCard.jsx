import { useCallback, useEffect, useState } from 'react'
import { ArrowUpRight, Check, CircleAlert, Clock3, HandCoins, Landmark, X, Zap } from 'lucide-react'
import { apiBase } from '../config/apiBase'

// "Withdraw" on Earnings, for businesses and riders. Instant when DOORSTEP has Paystack Transfers on; otherwise
// a withdrawal request that DOORSTEP approves and sends — with a simple tracker so the partner always knows
// where their money is.

const readToken = () => { try { return localStorage.getItem('doorstep-token') } catch { return null } }
async function call(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${apiBase}${path}`, { method, headers: { Authorization: `Bearer ${readToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Something went wrong. Try again.')
  return data
}
const money = (minor) => `₦${((minor || 0) / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`
const when = (value) => new Date(value).toLocaleString('en-NG', { weekday: 'short', hour: 'numeric', minute: '2-digit' })

const BLOCKED = {
  NO_ACCOUNT: 'Add your bank account below to withdraw.',
  DAILY_LIMIT: 'You’ve used today’s withdrawals. You can withdraw again tomorrow.',
  FEE_TOO_HIGH: 'Your ready balance is too small to cover the withdrawal fee.',
}

function Tracker({ request }) {
  const steps = [['Requested', true], ['Sent by DOORSTEP', request.status !== 'REQUESTED'], ['In your bank', false]]
  return <ol className="wd-track" aria-label="Withdrawal progress">{steps.map(([label, done], index) => <li key={label} className={done ? 'is-done' : index === steps.findIndex(([, isDone]) => !isDone) ? 'is-now' : ''}><span>{done ? <Check size={12} aria-hidden="true" /> : index + 1}</span>{label}</li>)}</ol>
}

/** `onAddAccount` opens the bank-account form; `onChanged` refreshes the rest of Earnings. */
export function WithdrawCard({ onAddAccount, onChanged }) {
  const [options, setOptions] = useState(null)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const load = useCallback(() => call('/api/finance/withdrawal-options').then((data) => { setOptions(data); setError('') }).catch((loadError) => setError(loadError.message)), [])
  useEffect(() => { load() }, [load])

  if (error && !options) return null
  if (!options) return <section className="wd-card is-loading" aria-busy="true"><p>Checking what you can withdraw…</p></section>

  const instant = options.mode === 'INSTANT'
  const withdraw = async () => {
    setBusy(true); setError('')
    try {
      if (instant) {
        const data = await call('/api/finance/withdraw', { method: 'POST' })
        setDone({ instant: true, amountMinor: data.payout.amountMinor, paid: data.payout.status === 'PAID' })
      } else {
        const data = await call('/api/finance/withdrawal-requests', { method: 'POST' })
        setDone({ instant: false, amountMinor: data.request.amountMinor })
      }
      setConfirming(false); load(); onChanged?.()
    } catch (withdrawError) { setError(withdrawError instanceof TypeError ? 'No connection. Nothing was withdrawn — try again.' : withdrawError.message) } finally { setBusy(false) }
  }
  const cancel = async () => {
    setBusy(true); setError('')
    try { await call(`/api/finance/withdrawal-requests/${options.openRequest.id}/cancel`, { method: 'POST' }); setDone(null); load(); onChanged?.() } catch (cancelError) { setError(cancelError.message) } finally { setBusy(false) }
  }

  const open = options.openRequest
  const feeText = options.fee.flatMinor || options.fee.percent ? `${options.fee.flatMinor ? money(options.fee.flatMinor) : ''}${options.fee.flatMinor && options.fee.percent ? ' + ' : ''}${options.fee.percent ? `${options.fee.percent}%` : ''} per withdrawal` : 'No fee'

  return <section className="wd-card" aria-labelledby="wd-title">
    <div className="wd-top">
      <div>
        <span className="wd-label" id="wd-title">{open ? 'Withdrawal on its way' : 'Ready to withdraw'}</span>
        <strong className="wd-amount">{money(open ? open.amountMinor : options.availableMinor)}</strong>
        {!open && options.heldMinor > 0 && <small className="wd-held"><Clock3 size={13} aria-hidden="true" />{money(options.heldMinor)} still clearing</small>}
      </div>
      <span className={`wd-mode${instant ? ' is-instant' : ''}`}>{instant ? <><Zap size={13} aria-hidden="true" />Instant</> : <><Clock3 size={13} aria-hidden="true" />Approved by DOORSTEP</>}</span>
    </div>

    {done && <p className="wd-ok" role="status"><Check size={16} aria-hidden="true" />{done.instant ? (done.paid ? `${money(done.amountMinor)} is on its way to your bank.` : `${money(done.amountMinor)} is being sent. We’ll notify you when your bank confirms.`) : `Request sent for ${money(done.amountMinor)}. DOORSTEP has been notified and will send it shortly.`}</p>}

    {open && <>
      <Tracker request={open} />
      <p className="wd-note">Requested {when(open.createdAt)}{open.feeMinor ? ` · fee ${money(open.feeMinor)}` : ''}. {open.status === 'REQUESTED' ? 'DOORSTEP sends withdrawals during working hours, usually the same day. You’ll get a notification when it’s sent.' : 'It’s being sent to your bank now.'}</p>
      {open.status === 'REQUESTED' && <button type="button" className="wd-ghost" disabled={busy} onClick={cancel}><X size={15} aria-hidden="true" />{busy ? 'Cancelling…' : 'Cancel request'}</button>}
    </>}

    {!open && !confirming && <>
      {options.account
        ? <p className="wd-to"><Landmark size={15} aria-hidden="true" />To {options.account.bankName} ••••{options.account.last4} · {options.account.accountName}</p>
        : null}
      {options.blocked && options.blocked !== 'BELOW_MINIMUM' && <p className="wd-blocked"><CircleAlert size={15} aria-hidden="true" />{BLOCKED[options.blocked] || 'Withdrawals aren’t available right now.'}</p>}
      {options.blocked === 'BELOW_MINIMUM' && <p className="wd-blocked is-soft">You can withdraw once {money(options.minimumMinor)} is ready.{options.availableMinor > 0 ? ` ${money(options.minimumMinor - options.availableMinor)} to go.` : ''}</p>}
      {options.blocked === 'NO_ACCOUNT'
        ? <button type="button" className="wd-primary" onClick={onAddAccount}><Landmark size={16} aria-hidden="true" />Add bank account</button>
        : <button type="button" className="wd-primary" disabled={Boolean(options.blocked)} onClick={() => { setDone(null); setError(''); setConfirming(true) }}><HandCoins size={17} aria-hidden="true" />Withdraw {money(options.netMinor)}</button>}
      <p className="wd-small">{feeText} · minimum {money(options.minimumMinor)} · {options.remainingToday} left today</p>
    </>}

    {!open && confirming && <div className="wd-confirm" role="group" aria-label="Confirm withdrawal">
      <dl>
        <div><dt>Ready now</dt><dd>{money(options.availableMinor)}</dd></div>
        <div><dt>Withdrawal fee</dt><dd>{options.feeMinor ? `−${money(options.feeMinor)}` : 'Free'}</dd></div>
        <div className="is-total"><dt>To your bank</dt><dd>{money(options.netMinor)}</dd></div>
      </dl>
      <p className="wd-to"><Landmark size={15} aria-hidden="true" />{options.account?.bankName} ••••{options.account?.last4} · {options.account?.accountName}</p>
      <p className="wd-small">{instant ? 'Sent by Paystack straight away. Most banks credit within minutes.' : 'DOORSTEP approves and sends it, usually the same working day. You can cancel until it’s sent.'}</p>
      <div className="wd-actions"><button type="button" className="wd-ghost" disabled={busy} onClick={() => setConfirming(false)}>Back</button><button type="button" className="wd-primary" disabled={busy} onClick={withdraw}><ArrowUpRight size={16} aria-hidden="true" />{busy ? 'Working…' : instant ? `Send ${money(options.netMinor)}` : `Request ${money(options.netMinor)}`}</button></div>
    </div>}
    {error && <p className="wd-error" role="alert">{error}</p>}
  </section>
}
