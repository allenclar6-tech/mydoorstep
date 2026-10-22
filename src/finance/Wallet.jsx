import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDownLeft, BadgeCheck, Banknote, Building2, CalendarClock, CircleAlert, Clock3, Crosshair, HandCoins, Info, Landmark, ShieldCheck, Zap } from 'lucide-react'
import { apiBase } from '../config/apiBase'
import { WithdrawCard } from './WithdrawCard'

const readToken = () => { try { return localStorage.getItem('doorstep-token') } catch { return null } }
async function call(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${apiBase}${path}`, { method, headers: { Authorization: `Bearer ${readToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Something went wrong. Try again.')
  return data
}
export const money = (minor) => `₦${((minor || 0) / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`
const ENTRY_STATUS = {
  DUE: ['To be paid out', 'warn'],
  PAYING: ['Paying now', 'live'],
  PAID: ['Paid out', 'done'],
  SETTLED_BY_SPLIT: ['Paid by Paystack', 'done'],
  NEEDS_REVIEW: ['Being priced', 'neutral'],
  VOID: ['Cancelled', 'neutral'],
}
const ENTRY_LABEL = { PARTNER_SHARE: 'Order earnings', ADJUSTMENT: 'Adjustment', RIDER_EARNING: 'Delivery earning', WITHDRAWAL_FEE: 'Cash-out fee', RIDER_SERVICE_FEE: 'DOORSTEP fee' }
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
async function openReceipt(payoutId) {
  const response = await fetch(`${apiBase}/api/finance/payouts/${payoutId}/receipt`, { headers: { Authorization: `Bearer ${readToken()}` } })
  if (!response.ok) throw new Error('Could not open the receipt.')
  const url = URL.createObjectURL(await response.blob())
  window.open(url, '_blank', 'noopener')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** DOORSTEP paid by bank transfer: the partner confirms it arrived (or says it didn't). */
function ConfirmPayment({ payout, onDone }) {
  const [disputing, setDisputing] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const answer = async (received) => {
    setBusy(true); setError('')
    try { await call(`/api/finance/payouts/${payout.id}/confirm`, { method: 'POST', body: received ? { received: true } : { received: false, note } }); onDone() } catch (answerError) { setError(answerError.message) } finally { setBusy(false) }
  }
  const sentTo = payout.bankSnapshot ? `${payout.bankSnapshot.bankName} ••••${payout.bankSnapshot.last4}` : 'your bank account'
  if (payout.status === 'DISPUTED') return <div className="wl-card wl-alert"><CircleAlert size={20} aria-hidden="true" /><div><strong>DOORSTEP is checking your {money(payout.amountMinor)} payment</strong><p>You said it hasn’t arrived: “{payout.disputeNote}”. We’ll update you here. If it shows up meanwhile, tell us.</p><button type="button" className="checkout-button" disabled={busy} onClick={() => answer(true)}>It has arrived now</button>{error && <p className="wl-error" role="alert">{error}</p>}</div></div>
  return <div className="wl-card wl-confirm-pay"><BadgeCheck size={20} aria-hidden="true" /><div>
    <strong>Did you receive {money(payout.amountMinor)}?</strong>
    <p>DOORSTEP sent it to {sentTo} on {new Date(payout.createdAt).toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' })}{payout.transferCode ? ` (ref ${payout.transferCode})` : ''}. Check your bank app, then confirm.</p>
    {payout.hasReceipt && <button type="button" className="text-link" onClick={() => openReceipt(payout.id).catch((openError) => setError(openError.message))}>View DOORSTEP’s receipt</button>}
    {!disputing ? <div className="wl-actions"><button type="button" className="quiet-button" onClick={() => setDisputing(true)}>I haven’t received it</button><button type="button" className="checkout-button" disabled={busy} onClick={() => answer(true)}>{busy ? 'Saving…' : 'Yes, I received it'}</button></div>
      : <div className="wl-form wl-dispute"><label>What did you check?<input value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Nothing in my account since Monday" /></label><div className="wl-actions"><button type="button" className="quiet-button" onClick={() => setDisputing(false)}>Back</button><button type="button" className="checkout-button" disabled={busy || note.trim().length < 3} onClick={() => answer(false)}>Tell DOORSTEP</button></div></div>}
    <p className="wl-muted">If you don’t answer within 3 days, it is marked as received.</p>
    {error && <p className="wl-error" role="alert">{error}</p>}
  </div></div>
}

const PAYOUT_LABEL = { WITHDRAWAL: 'Withdrawal', AUTOMATIC: 'Automatic payout', SCHEDULED: 'Scheduled payout' }

/** How and when DOORSTEP pays out (withdrawals live in WithdrawCard). */
function PayoutPlan({ payout, balances, rider }) {
  const available = balances.availableMinor
  const next = payout.nextAt ? new Date(payout.nextAt).toLocaleString('en-NG', { weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : null
  const hold = payout.holdHours ? ` ${payout.holdHours} hour${payout.holdHours === 1 ? '' : 's'} after` : ' once'
  const plan = payout.mode === 'AUTOMATIC'
    ? [Zap, 'Paid automatically', `Your money is sent to your bank${hold} ${rider ? 'each delivery is completed' : 'each order is delivered'}, when your cleared balance reaches ${money(payout.minimumMinor)}.`]
    : payout.mode === 'SCHEDULED'
      ? [CalendarClock, payout.frequency === 'DAILY' ? 'Paid every day' : 'Paid every week', `${next ? `Next payout: ${next}. ` : ''}Everything cleared by then is sent to your bank${payout.minimumMinor > 100 ? ` (from ${money(payout.minimumMinor)})` : ''}.`]
      : [Banknote, 'Paid by DOORSTEP', 'DOORSTEP sends what you’re owed to your bank and you’ll get a notification each time.']
  const [PlanIcon, planTitle, planText] = plan
  return <div className="wl-card wl-plan"><PlanIcon size={20} aria-hidden="true" /><div>
    <strong>{planTitle}</strong><p>{planText}</p>
    <div className="wl-split"><span><small>Ready now</small><b>{money(available)}</b></span><span><small>On hold</small><b>{money(balances.heldMinor)}</b></span></div>
    {balances.heldMinor > 0 && <p className="wl-muted">{rider ? 'Money on hold clears shortly after each delivery.' : 'Order money clears after the order is delivered'}{payout.holdHours ? ` and a ${payout.holdHours}-hour safety window.` : '.'}</p>}
  </div></div>
}

/** Add or change the bank account payouts go to. Paystack confirms the account name before anything is saved. */
function PayoutAccountForm({ current, onSaved, onCancel }) {
  const [banks, setBanks] = useState([])
  const [bankCode, setBankCode] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [resolved, setResolved] = useState(null)
  const [confirmed, setConfirmed] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { call('/api/finance/banks').then((data) => setBanks(data.banks)).catch((loadError) => setError(loadError.message)) }, [])
  const bank = banks.find((entry) => entry.code === bankCode)

  // Look the name up as soon as there are 10 digits and a bank.
  useEffect(() => {
    setResolved(null); setConfirmed(false)
    if (!bankCode || !/^\d{10}$/.test(accountNumber)) return undefined
    let active = true
    setBusy('resolve'); setError('')
    call('/api/finance/resolve-account', { method: 'POST', body: { bankCode, accountNumber } })
      .then((data) => { if (active) setResolved(data.accountName) })
      .catch((resolveError) => { if (active) setError(resolveError.message) })
      .finally(() => { if (active) setBusy('') })
    return () => { active = false }
  }, [bankCode, accountNumber])

  const save = async (event) => {
    event.preventDefault()
    setBusy('save'); setError('')
    try {
      const data = await call('/api/finance/payout-account', { method: 'PUT', body: { bankCode, bankName: bank?.name || '', accountNumber, password, confirmedName: resolved } })
      onSaved(data.account)
    } catch (saveError) { setError(saveError.message) } finally { setBusy('') }
  }

  return <form className="wl-form" onSubmit={save}>
    <h3>{current ? 'Change payout account' : 'Add your payout account'}</h3>
    <p className="wl-muted">Money is paid only into an account in your (or your business’s) name.</p>
    <label>Bank<select required value={bankCode} onChange={(event) => setBankCode(event.target.value)}><option value="">{banks.length ? 'Choose your bank' : 'Loading banks…'}</option>{banks.map((entry) => <option key={entry.code} value={entry.code}>{entry.name}</option>)}</select></label>
    <label>Account number<input required inputMode="numeric" autoComplete="off" maxLength={10} pattern="\d{10}" value={accountNumber} onChange={(event) => setAccountNumber(event.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="10 digits" /></label>
    {busy === 'resolve' && <p className="wl-muted" role="status">Checking with your bank…</p>}
    {resolved && <div className="wl-resolved"><BadgeCheck size={18} aria-hidden="true" /><div><small>Account name</small><strong>{resolved}</strong></div></div>}
    {resolved && <label className="wl-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> This is the right account</label>}
    {resolved && confirmed && <label>Your DOORSTEP password<input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /><small className="wl-muted">We ask for it because payout details are sensitive.</small></label>}
    {error && <p className="wl-error" role="alert">{error}</p>}
    <div className="wl-actions">
      {onCancel && <button type="button" className="quiet-button" onClick={onCancel}>Cancel</button>}
      <button type="submit" className="checkout-button" disabled={!resolved || !confirmed || !password || busy === 'save'}>{busy === 'save' ? 'Saving…' : 'Save payout account'}</button>
    </div>
  </form>
}

function PickupLocation() {
  const [state, setState] = useState('')
  const set = () => {
    if (!navigator.geolocation) { setState('This device cannot share its location.'); return }
    setState('Getting your location…')
    navigator.geolocation.getCurrentPosition(async (position) => {
      if (position.coords.accuracy > 150) { setState(`Location is only accurate to ${Math.round(position.coords.accuracy)} m. Stand outside your shop and try again.`); return }
      try { await call('/api/restaurant/location', { method: 'PUT', body: { latitude: position.coords.latitude, longitude: position.coords.longitude } }); setState('Pickup point saved. Delivery distances now start from here.') } catch (error) { setState(error.message) }
    }, () => setState('Location permission was denied.'), { enableHighAccuracy: true, timeout: 20000 })
  }
  return <div className="wl-card wl-tip"><Crosshair size={18} aria-hidden="true" /><div><strong>Pickup point</strong><p>Rider pay is based on the road distance from your shop to the customer. Set it once while standing at your shop.</p>{state && <p className="wl-muted" role="status">{state}</p>}<button type="button" className="quiet-button" onClick={set}>Use my current location</button></div></div>
}

/** Earnings, statement and payout account for a business or a rider. */
export function Wallet({ kind }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const load = useCallback(() => { call('/api/finance/summary').then(setData).catch((loadError) => setError(loadError.message)) }, [])
  useEffect(() => { load() }, [load])
  const rider = kind === 'RIDER'
  const entries = useMemo(() => (data?.entries || []).filter((entry) => entry.type !== 'PARTNER_SHARE' || entry.amountMinor !== 0), [data])

  if (error) return <div className="wl"><p className="wl-error">{error}</p></div>
  if (!data) return <div className="wl"><p className="wl-muted" role="status">Loading your earnings…</p></div>
  const { balances, account, rates, orders, payouts, payout } = data

  return <div className="wl">
    <section className="wl-hero">
      <span className="wl-hero-label">{rider ? 'Earnings to be paid' : 'Owed to you by DOORSTEP'}</span>
      <strong className="wl-hero-amount">{money(balances.dueMinor + balances.payingMinor)}</strong>
      <div className="wl-hero-row">
        {!rider && <span><Banknote size={15} aria-hidden="true" />{money(balances.settledBySplitMinor)} paid straight to your bank by Paystack</span>}
        <span><ArrowDownLeft size={15} aria-hidden="true" />{money(balances.paidMinor)} paid out by DOORSTEP</span>
        {balances.awaitingPriceCount > 0 && <span><Clock3 size={15} aria-hidden="true" />{balances.awaitingPriceCount} delivery earning(s) being priced</span>}
      </div>
    </section>

    {!account && !editing && <div className="wl-card wl-alert"><CircleAlert size={20} aria-hidden="true" /><div><strong>Add a bank account to get paid</strong><p>{rider ? 'Your delivery earnings are paid into this account.' : 'Paystack sends your share of each card payment straight to this account, usually by the next working day.'}</p><button type="button" className="checkout-button" onClick={() => setEditing(true)}>Add bank account</button></div></div>}
    {account && !editing && <div className="wl-card wl-account"><Landmark size={20} aria-hidden="true" /><div><small>Payouts go to</small><strong>{account.bankName} {account.accountNumber}</strong><span>{account.accountName}</span>{!rider && <span className="wl-chip is-done">{account.splitReady ? 'Automatic payments on' : 'Automatic payments pending'}</span>}</div><button type="button" className="quiet-button" onClick={() => setEditing(true)}>Change</button></div>}
    {editing && <PayoutAccountForm current={account} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); load() }} />}
    {payouts.filter((entry) => ['AWAITING_CONFIRMATION', 'DISPUTED'].includes(entry.status)).map((entry) => <ConfirmPayment key={entry.id} payout={entry} onDone={load} />)}
    {/* Withdraw: instant by Paystack when available, otherwise a request DOORSTEP approves. */}
    <WithdrawCard onAddAccount={() => setEditing(true)} onChanged={load} />
    {payout && <PayoutPlan payout={payout} balances={balances} rider={rider} />}

    <div className="wl-card wl-rates"><Info size={18} aria-hidden="true" /><div>
      {rider ? (rates.riderPay ? <><strong>How your delivery pay is worked out</strong><p>By road distance from pickup to drop-off{rates.riderFeePercent > 0 ? `. DOORSTEP keeps ${rates.riderFeePercent}% of each delivery earning as its service fee` : ''}:</p><ul>{rates.riderPay.bands.map((band, index) => <li key={band.upToKm}><span>{index === 0 ? 'Up to' : `${rates.riderPay.bands[index - 1].upToKm}–`}{band.upToKm} km</span><b>{money(band.amountMinor)}</b></li>)}{rates.riderPay.perKmAfterMinor > 0 && <li><span>Each km after {rates.riderPay.bands.at(-1).upToKm} km</span><b>+{money(rates.riderPay.perKmAfterMinor)}</b></li>}</ul></> : <><strong>Delivery pay rates</strong><p>DOORSTEP hasn’t published the Sapele rate table yet. Your deliveries are still recorded and will be priced and paid.{rates.riderFeePercent > 0 ? ` DOORSTEP keeps ${rates.riderFeePercent}% of each delivery earning as its service fee.` : ''}</p></>)
        : <><strong>How DOORSTEP’s commission works</strong><p><b>{rates.doorstepRiderPercent}%</b> of the item total when a DOORSTEP rider delivers. <b>{rates.ownRiderPercent}%</b> when your own rider delivers, and you also keep that order’s delivery fee. Service and delivery fees are never counted as your sales.</p></>}
    </div></div>

    {!rider && orders && <section className="wl-stats">
      <div><span>Orders</span><strong>{orders.count}</strong></div>
      <div><span>Item sales</span><strong>{money(orders.salesMinor)}</strong></div>
      <div><span>Commission</span><strong>{money(orders.commissionMinor)}</strong></div>
    </section>}
    {!rider && <PickupLocation />}

    <section className="wl-card wl-statement">
      <h3>Statement</h3>
      {entries.length === 0 && <p className="wl-muted">{rider ? 'Completed deliveries will show here.' : 'Paid orders will show here.'}</p>}
      <ul>{entries.map((entry) => {
        const [label, tone] = ENTRY_STATUS[entry.status] || [entry.status, 'neutral']
        return <li key={entry.id}>
          <span className="wl-st-icon" aria-hidden="true">{entry.type === 'RIDER_EARNING' ? <Banknote size={16} /> : <Building2 size={16} />}</span>
          <span className="wl-st-main"><strong>{ENTRY_LABEL[entry.type] || entry.type}</strong><small>{entry.description}</small><small>{new Date(entry.createdAt).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</small></span>
          <span className="wl-st-amount"><b className={entry.amountMinor < 0 ? 'is-negative' : ''}>{entry.status === 'NEEDS_REVIEW' ? '—' : `${entry.amountMinor < 0 ? '−' : ''}${money(Math.abs(entry.amountMinor))}`}</b><span className={`wl-chip is-${tone}`}>{label}</span></span>
        </li>
      })}</ul>
    </section>

    {payouts.length > 0 && <section className="wl-card wl-statement">
      <h3>Payouts</h3>
      <ul>{payouts.map((payout) => <li key={payout.id}>
        <span className="wl-st-icon" aria-hidden="true"><ArrowDownLeft size={16} /></span>
        <span className="wl-st-main"><strong>{payout.source === 'WITHDRAWAL' ? 'Withdrawal' : payout.method === 'MANUAL' ? 'Bank transfer from DOORSTEP' : PAYOUT_LABEL[payout.source] || 'Paystack transfer'}</strong><small>{new Date(payout.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}{payout.feeMinor > 0 ? ` · fee ${money(payout.feeMinor)}` : ''}{payout.status === 'FAILED' ? ' · failed, the amount is owed again' : ''}</small></span>
        <span className="wl-st-amount"><b>{money(payout.amountMinor)}</b><span className={`wl-chip is-${payout.status === 'PAID' ? 'done' : payout.status === 'FAILED' || payout.status === 'DISPUTED' ? 'bad' : payout.status === 'AWAITING_CONFIRMATION' ? 'warn' : 'live'}`}>{payout.status === 'PAID' ? 'Received' : payout.status === 'FAILED' ? 'Failed' : payout.status === 'AWAITING_CONFIRMATION' ? 'Confirm' : payout.status === 'DISPUTED' ? 'Being checked' : payout.status === 'REQUESTED' ? 'Requested' : 'Processing'}</span></span>
      </li>)}</ul>
    </section>}
    <p className="wl-foot"><ShieldCheck size={14} aria-hidden="true" />Payments are processed by Paystack. DOORSTEP stores only the last 4 digits of your account.</p>
  </div>
}
