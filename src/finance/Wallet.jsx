import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDownLeft, BadgeCheck, Banknote, Building2, CircleAlert, Clock3, Crosshair, Info, Landmark, ShieldCheck } from 'lucide-react'
import { apiBase } from '../config/apiBase'

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
}
const ENTRY_LABEL = { PARTNER_SHARE: 'Order earnings', ADJUSTMENT: 'Adjustment', RIDER_EARNING: 'Delivery earning' }

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
  const { balances, account, rates, orders, payouts } = data

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

    <div className="wl-card wl-rates"><Info size={18} aria-hidden="true" /><div>
      {rider ? (rates.riderPay ? <><strong>How your delivery pay is worked out</strong><p>By road distance from pickup to drop-off:</p><ul>{rates.riderPay.bands.map((band, index) => <li key={band.upToKm}><span>{index === 0 ? 'Up to' : `${rates.riderPay.bands[index - 1].upToKm}–`}{band.upToKm} km</span><b>{money(band.amountMinor)}</b></li>)}{rates.riderPay.perKmAfterMinor > 0 && <li><span>Each km after {rates.riderPay.bands.at(-1).upToKm} km</span><b>+{money(rates.riderPay.perKmAfterMinor)}</b></li>}</ul></> : <><strong>Delivery pay rates</strong><p>DOORSTEP hasn’t published the Sapele rate table yet. Your deliveries are still recorded and will be priced and paid.</p></>)
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
        <span className="wl-st-main"><strong>{payout.method === 'MANUAL' ? 'Bank transfer from DOORSTEP' : 'Paystack transfer'}</strong><small>{new Date(payout.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}{payout.status === 'FAILED' ? ' · failed, the amount is owed again' : ''}</small></span>
        <span className="wl-st-amount"><b>{money(payout.amountMinor)}</b><span className={`wl-chip is-${payout.status === 'PAID' ? 'done' : payout.status === 'FAILED' ? 'bad' : 'live'}`}>{payout.status === 'PAID' ? 'Sent' : payout.status === 'FAILED' ? 'Failed' : 'Processing'}</span></span>
      </li>)}</ul>
    </section>}
    <p className="wl-foot"><ShieldCheck size={14} aria-hidden="true" />Payments are processed by Paystack. DOORSTEP stores only the last 4 digits of your account.</p>
  </div>
}
