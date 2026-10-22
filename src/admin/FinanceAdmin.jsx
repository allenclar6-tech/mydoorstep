import { useCallback, useEffect, useState } from 'react'
import { Bike, Building2, Coins, Package, Plus, RefreshCw, Save, Trash2, Truck } from 'lucide-react'
import { apiBase } from '../config/apiBase'
import { AdjustmentCard, CommissionCard, PayoutSettingsCard } from './PayoutControls'
import { openAdminReceipt, PartnerPayPanel } from './PartnerPayPanel'

const token = () => { try { return localStorage.getItem('doorstep-admin-token') } catch { return null } }
async function call(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${apiBase}${path}`, { method, headers: { Authorization: `Bearer ${token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Something went wrong. Try again.')
  return data
}
const money = (minor) => `₦${((minor || 0) / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`
const toMinor = (naira) => Math.round(Number(naira || 0) * 100)
const PAYOUT_STATUS = { PAID: ['paid', 'live'], FAILED: ['failed', 'warn'], AWAITING_CONFIRMATION: ['waiting for partner', 'neutral'], DISPUTED: ['not received', 'warn'], PROCESSING: ['processing', 'neutral'], PENDING: ['sending', 'neutral'] }

function ResolvePayout({ payout, onDone }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const resolve = async (action) => {
    if (action === 'CANCEL' && !window.confirm('Cancel this payout? The money becomes owed to them again.')) return
    setBusy(true); setError('')
    try { await call(`/api/admin/finance/payouts/${payout.id}/resolve`, { method: 'POST', body: { action, note } }); onDone() } catch (resolveError) { setError(resolveError.message) } finally { setBusy(false) }
  }
  return <span className="fa-manual po-resolve"><input value={note} onChange={(event) => setNote(event.target.value)} placeholder={payout.status === 'DISPUTED' ? 'What your bank shows' : 'Note'} aria-label="Note" /><button type="button" className="row-more" disabled={busy || note.trim().length < 3} onClick={() => resolve('MARK_PAID')}>Mark received</button><button type="button" className="row-more" disabled={busy || note.trim().length < 3} onClick={() => resolve('CANCEL')}>Cancel payout</button>{error && <small className="fa-error">{error}</small>}</span>
}

const SOURCE_LABEL = { AUTOMATIC: 'automatic', SCHEDULED: 'scheduled', BULK: 'pay everyone', WITHDRAWAL: 'cash-out' }

function SettingsForm({ onSaved }) {
  const [form, setForm] = useState(null)
  const [transfersEnabled, setTransfersEnabled] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    call('/api/admin/finance/settings').then((data) => {
      setTransfersEnabled(data.transfersEnabled)
      const value = data.settings
      setForm({ doorstep: value.commission.doorstepRiderPercent, own: value.commission.ownRiderPercent, riderEnabled: value.riderPay.enabled, bands: value.riderPay.bands.map((band) => ({ upToKm: band.upToKm, naira: band.amountMinor / 100 })), perKm: (value.riderPay.perKmAfterMinor || 0) / 100, splitEnabled: value.split.enabled, feeBearer: value.split.feeBearer, riderFee: value.riderFee?.percent ?? 6 })
    }).catch((error) => setMessage(error.message))
  }, [])
  if (!form) return <section className="fa-card"><p className="fa-muted">{message || 'Loading settings…'}</p></section>
  const update = (patch) => setForm((current) => ({ ...current, ...patch }))
  const setBand = (index, patch) => update({ bands: form.bands.map((band, position) => position === index ? { ...band, ...patch } : band) })
  const save = async (event) => {
    event.preventDefault()
    setBusy(true); setMessage('')
    try {
      await call('/api/admin/finance/settings', { method: 'PUT', body: {
        commission: { doorstepRiderPercent: Number(form.doorstep), ownRiderPercent: Number(form.own) },
        riderPay: { enabled: form.riderEnabled, bands: form.bands.filter((band) => band.upToKm !== '' && band.naira !== '').map((band) => ({ upToKm: Number(band.upToKm), amountMinor: toMinor(band.naira) })), perKmAfterMinor: toMinor(form.perKm) },
        split: { enabled: form.splitEnabled, feeBearer: form.feeBearer },
        riderFee: { percent: Number(form.riderFee) },
      } })
      setMessage('Saved. New orders and deliveries use these rates; past ones keep theirs.')
      onSaved?.()
    } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }
  return <form className="fa-card fa-settings" onSubmit={save}>
    <h3>Commission & rider pay</h3>
    <div className="fa-grid">
      <label>Commission when a DOORSTEP rider delivers (%)<input type="number" min="0" max="50" step="0.5" required value={form.doorstep} onChange={(event) => update({ doorstep: event.target.value })} /></label>
      <label>Commission when the business’s own rider delivers (%)<input type="number" min="0" max="50" step="0.5" required value={form.own} onChange={(event) => update({ own: event.target.value })} /></label>
    </div>
    <p className="fa-muted">Taken from the item subtotal only. With its own rider, the business also keeps the delivery fee.</p>

    <fieldset className="fa-bands">
      <legend>Sapele rider pay by road distance</legend>
      <p className="fa-muted">Enter your official rate per distance band. Until this is switched on, deliveries are recorded as “to be priced” and nothing is guessed.</p>
      {form.bands.map((band, index) => <div className="fa-band" key={index}>
        <label>Up to (km)<input type="number" min="0.1" max="100" step="0.1" required value={band.upToKm} onChange={(event) => setBand(index, { upToKm: event.target.value })} /></label>
        <label>Rider earns (₦)<input type="number" min="0" step="50" required value={band.naira} onChange={(event) => setBand(index, { naira: event.target.value })} /></label>
        <button type="button" className="fa-icon" aria-label="Remove band" onClick={() => update({ bands: form.bands.filter((_, position) => position !== index) })}><Trash2 size={16} /></button>
      </div>)}
      <button type="button" className="row-more" onClick={() => update({ bands: [...form.bands, { upToKm: '', naira: '' }] })}><Plus size={14} /> Add distance band</button>
      <label>DOORSTEP fee on each delivery (% of the rider’s earning)<input type="number" min="0" max="30" step="0.5" required value={form.riderFee} onChange={(event) => update({ riderFee: event.target.value })} /><small className="fa-muted">Shown to riders as a separate line. Applies to deliveries completed from now on.</small></label>
      <label>Each extra km after the last band (₦, 0 = flat)<input type="number" min="0" step="10" value={form.perKm} onChange={(event) => update({ perKm: event.target.value })} /></label>
      <label className="fa-switch"><input type="checkbox" checked={form.riderEnabled} onChange={(event) => update({ riderEnabled: event.target.checked })} /> Use these rates for rider pay</label>
    </fieldset>

    <fieldset className="fa-bands">
      <legend>Paystack</legend>
      <label className="fa-switch"><input type="checkbox" checked={form.splitEnabled} onChange={(event) => update({ splitEnabled: event.target.checked })} /> Pay businesses automatically with Paystack split</label>
      <label>Who pays Paystack’s fee on split payments<select value={form.feeBearer} onChange={(event) => update({ feeBearer: event.target.value })}><option value="account">DOORSTEP</option><option value="all-proportional">Shared by size of share</option></select></label>
      <p className="fa-muted">Rider payouts by Paystack Transfer are {transfersEnabled ? <b>on</b> : <><b>off</b>. Turn on Transfers in Paystack, then set PAYSTACK_TRANSFERS_ENABLED=true on the API. Until then, pay by bank and record it under “To pay out”.</>} Payout timing is set under Payouts above.</p>
    </fieldset>
    {message && <p className="fa-muted" role="status">{message}</p>}
    <button type="submit" className="admin-primary" disabled={busy}><Save size={14} /> {busy ? 'Saving…' : 'Save settings'}</button>
  </form>
}

function PayRow({ row, transfersEnabled, onPaid }) {
  const [manual, setManual] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pay = async (method) => {
    setBusy(true); setError('')
    try {
      await call('/api/admin/finance/payouts', { method: 'POST', body: { ...(row.riderId ? { riderId: row.riderId } : { restaurantId: row.restaurantId }), method } })
      onPaid()
    } catch (payError) { setError(payError.message) } finally { setBusy(false) }
  }
  return <li className="fa-owed">
    <span className="fa-owed-icon" aria-hidden="true">{row.riderId ? <Bike size={16} /> : <Building2 size={16} />}</span>
    <span className="fa-owed-main"><strong>{row.name}</strong><small>{row.account ? `${row.account.bankName} ••••${row.account.last4} · ${row.account.accountName}` : 'No bank account added yet'}</small>{error && <small className="fa-error">{error}</small>}
    </span>
    {manual && <PartnerPayPanel row={row} onClose={() => setManual(false)} onPaid={onPaid} />}
    <span className="fa-owed-amount"><b className={row.amountMinor < 0 ? 'is-negative' : ''}>{money(row.amountMinor)}</b>
      {row.amountMinor >= 100 && <span className="fa-owed-actions">
        {transfersEnabled && row.account?.transfersReady && <button type="button" className="admin-primary" disabled={busy} onClick={() => pay('PAYSTACK_TRANSFER')}>{busy ? 'Sending…' : 'Pay via Paystack'}</button>}
        <button type="button" className="row-more" onClick={() => setManual(true)}>Pay manually</button>
      </span>}
      {row.amountMinor < 0 && <small className="fa-muted">Owes DOORSTEP; deducted from future earnings</small>}
    </span>
  </li>
}

function PriceRow({ entry, onDone }) {
  const [naira, setNaira] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async () => {
    setBusy(true); setError('')
    try { await call(`/api/admin/finance/entries/${entry.id}/price`, { method: 'POST', body: { amountMinor: toMinor(naira) } }); onDone() } catch (saveError) { setError(saveError.message) } finally { setBusy(false) }
  }
  return <li className="fa-owed"><span className="fa-owed-icon" aria-hidden="true"><Truck size={16} /></span><span className="fa-owed-main"><strong>Rider earning to price</strong><small>{entry.description}</small>{error && <small className="fa-error">{error}</small>}</span><span className="fa-manual"><input type="number" min="0" step="50" value={naira} onChange={(event) => setNaira(event.target.value)} placeholder="₦" aria-label="Amount in naira" /><button type="button" className="admin-primary" disabled={busy || naira === ''} onClick={save}>Set</button></span></li>
}

/** Admin → Money: DOORSTEP's income, what businesses and riders are owed, payouts and rate settings. */
export function FinanceAdmin() {
  const [overview, setOverview] = useState(null)
  const [review, setReview] = useState([])
  const [payouts, setPayouts] = useState([])
  const [payees, setPayees] = useState(null)
  const [platform, setPlatform] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(() => {
    Promise.all([call('/api/admin/finance/overview'), call('/api/admin/finance/entries?status=NEEDS_REVIEW'), call('/api/admin/finance/payouts'), call('/api/admin/finance/payees'), call('/api/admin/finance/settings')])
      .then(([overviewData, reviewData, payoutData, payeeData, settingsData]) => { setOverview(overviewData); setReview(reviewData.entries); setPayouts(payoutData.payouts); setPayees(payeeData); setPlatform(settingsData.settings.commission); setError('') })
      .catch((loadError) => setError(loadError.message))
  }, [])
  useEffect(() => { load() }, [load])
  const refresh = async (payout) => { try { await call(`/api/admin/finance/payouts/${payout.id}/refresh`, { method: 'POST' }); load() } catch (refreshError) { setError(refreshError.message) } }

  const income = overview?.income
  const totalIncome = income ? income.commissionMinor + income.serviceFeesMinor + income.deliveryFeesMinor + income.parcelRevenueMinor + (income.cashOutFeesMinor || 0) + (income.riderFeesMinor || 0) : 0
  const owedTotal = overview?.owed.filter((row) => row.amountMinor > 0).reduce((sum, row) => sum + row.amountMinor, 0) || 0
  return <div className="fa">
    <div className="admin-intro"><div><span className="section-kicker">MONEY</span><h2>Where every naira goes.</h2></div><button type="button" className="row-more" onClick={load}><RefreshCw size={14} /> Refresh</button></div>
    {error && <p className="fa-error fa-pad">{error}</p>}
    <section className="fa-cards">
      <div className="fa-stat is-main"><span><Coins size={16} aria-hidden="true" />DOORSTEP income</span><strong>{money(totalIncome)}</strong><small>Kept in your Paystack account</small></div>
      <div className="fa-stat"><span>Commission</span><strong>{money(income?.commissionMinor)}</strong></div>
      <div className="fa-stat"><span>Delivery fees</span><strong>{money(income?.deliveryFeesMinor)}</strong></div>
      <div className="fa-stat"><span>Service fees</span><strong>{money(income?.serviceFeesMinor)}</strong></div>
      <div className="fa-stat"><span><Package size={14} aria-hidden="true" />Package deliveries</span><strong>{money(income?.parcelRevenueMinor)}</strong></div>
      <div className="fa-stat"><span>Rider delivery fees</span><strong>{money(income?.riderFeesMinor)}</strong></div>
      {income?.cashOutFeesMinor > 0 && <div className="fa-stat"><span>Cash-out fees</span><strong>{money(income.cashOutFeesMinor)}</strong></div>}
      <div className="fa-stat is-owed"><span>Owed to businesses & riders</span><strong>{money(owedTotal)}</strong><small>{overview?.payoutsProcessing ? `${overview.payoutsProcessing} transfer(s) processing` : 'Ready to pay out'}</small></div>
    </section>
    <p className="fa-muted fa-pad">Rider pay and anything not settled automatically is paid from your DOORSTEP Paystack balance. Rider pay is not deducted from these income totals.</p>

    {review.length > 0 && <section className="fa-card"><h3>Needs a price ({review.length})</h3><ul className="fa-list">{review.map((entry) => <PriceRow key={entry.id} entry={entry} onDone={load} />)}</ul></section>}

    <section className="fa-card"><h3>To pay out</h3>
      {overview?.owed.length === 0 && <p className="fa-muted">Nobody is owed anything right now.</p>}
      <ul className="fa-list">{overview?.owed.map((row) => <PayRow key={`${row.restaurantId || ''}${row.riderId || ''}`} row={row} transfersEnabled={overview.transfersEnabled} onPaid={load} />)}</ul>
    </section>

    {payouts.length > 0 && <section className="fa-card"><h3>Payout history</h3><ul className="fa-list">{payouts.map((payout) => <li key={payout.id} className="fa-owed">
      <span className="fa-owed-icon" aria-hidden="true">{payout.party === 'RIDER' ? <Bike size={16} /> : <Building2 size={16} />}</span>
      <span className="fa-owed-main"><strong>{payout.bankSnapshot?.accountName || payout.party}</strong><small>{new Date(payout.createdAt).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · {payout.method === 'MANUAL' ? `Bank ref ${payout.transferCode}` : 'Paystack transfer'}{SOURCE_LABEL[payout.source] ? ` · ${SOURCE_LABEL[payout.source]}` : ''}{payout.feeMinor > 0 ? ` · fee ${money(payout.feeMinor)}` : ''}</small>{payout.failureReason && <small className="fa-error">{payout.failureReason}</small>}{payout.disputeNote && payout.status === 'DISPUTED' && <small className="fa-error">Partner says: {payout.disputeNote}</small>}{payout.confirmedAt && <small>Confirmed {new Date(payout.confirmedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}</small>}{payout.receiptKey && <button type="button" className="text-link po-receipt" onClick={() => openAdminReceipt(payout.id).catch((openError) => setError(openError.message))}>View receipt</button>}{['AWAITING_CONFIRMATION', 'DISPUTED'].includes(payout.status) && <ResolvePayout payout={payout} onDone={load} />}</span>
      <span className="fa-owed-amount"><b>{money(payout.amountMinor)}</b><span className={`sd-status is-${(PAYOUT_STATUS[payout.status] || [null, 'neutral'])[1]}`}>{(PAYOUT_STATUS[payout.status] || [payout.status.toLowerCase()])[0]}</span>{payout.status === 'PROCESSING' && <button type="button" className="row-more" onClick={() => refresh(payout)}>Check status</button>}</span>
    </li>)}</ul></section>}

    <PayoutSettingsCard onChanged={load} />
    <AdjustmentCard payees={payees} onDone={load} />
    <CommissionCard payees={payees} platform={platform} onSaved={load} />
    <SettingsForm onSaved={load} />
  </div>
}
