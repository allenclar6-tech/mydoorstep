import { useEffect, useState } from 'react'
import { Check, Copy, FileText, Landmark, Mail, Phone, Upload, X } from 'lucide-react'
import { apiBase } from '../config/apiBase'

// Admin → Money → Pay manually: everything needed to pay a business or rider from DOORSTEP's own bank app,
// then record it. The partner confirms receipt in their Earnings before the payout counts as complete.

const token = () => { try { return localStorage.getItem('doorstep-admin-token') } catch { return null } }
async function call(path, { method = 'GET', body, form } = {}) {
  const response = await fetch(`${apiBase}${path}`, { method, headers: { Authorization: `Bearer ${token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: form || (body ? JSON.stringify(body) : undefined) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Something went wrong. Try again.')
  return data
}
const money = (minor) => `${minor < 0 ? '−' : ''}₦${(Math.abs(minor || 0) / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`
const LINE_LABEL = { PARTNER_SHARE: 'Order share', ADJUSTMENT: 'Adjustment', RIDER_EARNING: 'Delivery', RIDER_SERVICE_FEE: 'DOORSTEP fee' }

/** Opens a receipt that needs the admin's sign-in. */
export async function openAdminReceipt(payoutId) {
  const response = await fetch(`${apiBase}/api/admin/finance/payouts/${payoutId}/receipt`, { headers: { Authorization: `Bearer ${token()}` } })
  if (!response.ok) throw new Error('Could not open the receipt.')
  const url = URL.createObjectURL(await response.blob())
  window.open(url, '_blank', 'noopener')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function CopyField({ label, value }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(String(value)); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { setCopied(false) }
  }
  return <div className="pp-copy"><small>{label}</small><b>{value || '—'}</b>{value && <button type="button" className="row-more" onClick={copy} aria-label={`Copy ${label}`}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy'}</button>}</div>
}

export function PartnerPayPanel({ row, onClose, onPaid }) {
  const kind = row.riderId ? 'rider' : 'business'
  const id = row.riderId || row.restaurantId
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [scope, setScope] = useState('ALL')
  const [reference, setReference] = useState('')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  useEffect(() => { call(`/api/admin/finance/payees/${kind}/${id}`).then(setData).catch((loadError) => setError(loadError.message)) }, [kind, id])
  const amount = data ? (scope === 'ALL' ? data.balance.dueMinor : data.balance.availableMinor) : 0

  const record = async (event) => {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const { payout } = await call('/api/admin/finance/payouts', { method: 'POST', body: { [row.riderId ? 'riderId' : 'restaurantId']: id, method: 'MANUAL', manualReference: reference.trim(), scope } })
      let receiptNote = ''
      if (file) {
        const form = new FormData()
        form.append('receipt', file)
        try { await call(`/api/admin/finance/payouts/${payout.id}/receipt`, { method: 'POST', form }) } catch (uploadError) { receiptNote = ` The receipt didn’t upload (${uploadError.message}); the payment is still recorded.` }
      }
      setDone(`${money(payout.amountMinor)} recorded. ${data.profile.name} has been asked to confirm they received it.${receiptNote}`)
      onPaid()
    } catch (recordError) { setError(recordError.message) } finally { setBusy(false) }
  }

  return <div className="pp-backdrop" role="dialog" aria-modal="true" aria-label={`Pay ${row.name}`}>
    <div className="pp-sheet">
      <div className="pp-head"><div><span className="section-kicker">PAY MANUALLY</span><h3>{row.name}</h3></div><button type="button" className="fa-icon pp-close" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
      {!data && !error && <p className="fa-muted">Loading their details…</p>}
      {error && <p className="fa-error" role="alert">{error}</p>}
      {data && <>
        <section className="pp-block">
          <h4>Contact</h4>
          <p className="fa-muted">{[data.profile.owner, data.profile.detail].filter(Boolean).join(' · ')}</p>
          <div className="pp-contacts">
            {data.profile.phone && <a className="row-more" href={`tel:${data.profile.phone}`}><Phone size={14} /> {data.profile.phone}</a>}
            {data.profile.whatsApp && <a className="row-more" href={`https://wa.me/${data.profile.whatsApp.replace(/\D/g, '').replace(/^0/, '234')}`} target="_blank" rel="noreferrer">WhatsApp</a>}
            {data.profile.email && <a className="row-more" href={`mailto:${data.profile.email}`}><Mail size={14} /> {data.profile.email}</a>}
          </div>
        </section>

        <section className="pp-block pp-bank">
          <h4><Landmark size={15} aria-hidden="true" /> Bank account</h4>
          {!data.bank ? <p className="fa-error">They haven’t added a bank account yet. Ask them to add one under Earnings before paying.</p> : <>
            <CopyField label="Bank" value={data.bank.bankName} />
            <CopyField label="Account number" value={data.bank.accountNumber || `••••${data.bank.last4}`} />
            <CopyField label="Account name" value={data.bank.accountName} />
            {data.bank.lookupError && <p className="fa-error">Full number unavailable: {data.bank.lookupError} Ask the partner to confirm it.</p>}
            {data.bank.verifiedAt && <p className="fa-muted">Name confirmed by their bank through Paystack on {new Date(data.bank.verifiedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}.</p>}
          </>}
        </section>

        <section className="pp-block">
          <h4>What they’re owed</h4>
          {data.lines.length === 0 ? <p className="fa-muted">Nothing is owed right now.</p> : <ul className="pp-lines">{data.lines.map((line) => <li key={line.id}>
            <span><b>{line.order?.orderNumber || LINE_LABEL[line.type] || line.type}</b>
              <small>{line.order ? `Sales ${money(line.order.salesMinor)}${line.order.commissionPercent != null ? ` · ${line.order.commissionPercent}% commission −${money(line.order.commissionMinor)}` : ''}${line.order.deliveryFeeKeptMinor ? ` · delivery fee +${money(line.order.deliveryFeeKeptMinor)}` : ''}` : line.description}</small>
              {!line.cleared && <small className="pp-hold">{line.order && line.order.status !== 'DELIVERED' ? `Order ${line.order.status.toLowerCase().replaceAll('_', ' ')}` : 'On hold'}</small>}
            </span>
            <b className={line.amountMinor < 0 ? 'is-negative' : ''}>{money(line.amountMinor)}</b>
          </li>)}</ul>}
          <div className="pp-totals"><span>Owed in total <b>{money(data.balance.dueMinor)}</b></span><span>Cleared <b>{money(data.balance.availableMinor)}</b></span></div>
        </section>

        {done ? <p className="pp-done" role="status"><Check size={16} aria-hidden="true" /> {done}</p> : data.bank && data.balance.dueMinor >= 100 && <form className="pp-block fa-settings" onSubmit={record}>
          <h4>Record your payment</h4>
          <p className="fa-muted">Send the money from your bank app first, then record it here. It is complete once {data.profile.name} confirms it arrived (or after 3 days without an answer).</p>
          {data.balance.availableMinor !== data.balance.dueMinor && data.balance.availableMinor >= 100 && <div className="po-modes pp-scope" role="radiogroup" aria-label="Amount">
            <button type="button" role="radio" aria-checked={scope === 'ALL'} className={scope === 'ALL' ? 'is-on' : ''} onClick={() => setScope('ALL')}><b>Everything owed</b><small>{money(data.balance.dueMinor)}</small></button>
            <button type="button" role="radio" aria-checked={scope === 'AVAILABLE'} className={scope === 'AVAILABLE' ? 'is-on' : ''} onClick={() => setScope('AVAILABLE')}><b>Cleared only</b><small>{money(data.balance.availableMinor)}</small></button>
          </div>}
          <p className="pp-amount">Send exactly <b>{money(amount)}</b></p>
          <label>Bank transfer reference<input required minLength={3} maxLength={80} value={reference} onChange={(event) => setReference(event.target.value)} placeholder="From your bank app’s receipt" /></label>
          <label className="pp-file"><span><Upload size={14} aria-hidden="true" /> Receipt (optional, JPG/PNG/PDF)</span><input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(event) => setFile(event.target.files?.[0] || null)} />{file && <small><FileText size={13} aria-hidden="true" /> {file.name}</small>}</label>
          <button type="submit" className="admin-primary" disabled={busy || reference.trim().length < 3 || amount < 100}>{busy ? 'Recording…' : `I’ve sent ${money(amount)}`}</button>
        </form>}
      </>}
    </div>
  </div>
}
