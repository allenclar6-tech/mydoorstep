import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, CheckCircle2, Clock3, Copy, FileText, ImageUp, Landmark, RefreshCw, Upload, XCircle } from 'lucide-react'
import { apiBase } from '../config/apiBase'
import { formatNaira } from '../data'

// Bank transfer checkout: clear account details with copy buttons, a receipt upload so DOORSTEP can match the
// payment faster, and a status check that actually says what is happening (and keeps checking by itself).

const token = () => { try { return localStorage.getItem('doorstep-token') } catch { return null } }
const navigate = (path) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')) }
const AUTO_CHECK_MS = 20_000
const ACCEPT = 'image/jpeg,image/png,application/pdf'

const STATUS = {
  PENDING_VERIFICATION: { tone: 'wait', title: 'Waiting for your transfer', icon: Clock3 },
  SUCCESSFUL: { tone: 'ok', title: 'Payment confirmed', icon: CheckCircle2 },
  FAILED: { tone: 'bad', title: 'Transfer not received', icon: XCircle },
  AMOUNT_MISMATCH: { tone: 'bad', title: 'Wrong amount received', icon: XCircle },
  EXPIRED: { tone: 'bad', title: 'Transfer time ran out', icon: XCircle },
}
const timeLeft = (until, now) => {
  const ms = new Date(until).getTime() - now
  if (ms <= 0) return null
  const minutes = Math.floor(ms / 60_000)
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${Math.max(1, minutes)} min`
}
const clock = (value) => new Date(value).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' })

function CopyRow({ label, value, display, copied, onCopy, strong }) {
  return <div className={`bt-row${strong ? ' is-strong' : ''}`}>
    <dt>{label}</dt>
    <dd><span>{display ?? value}</span>{onCopy && <button type="button" className={`bt-copy${copied ? ' is-done' : ''}`} onClick={onCopy} aria-label={`Copy ${label.toLowerCase()}`}>{copied ? <><Check size={14} aria-hidden="true" />Copied</> : <><Copy size={14} aria-hidden="true" />Copy</>}</button>}</dd>
  </div>
}

function ReceiptForm({ orderId, receipt, onUploaded }) {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState('')
  const [senderName, setSenderName] = useState('')
  const [senderBank, setSenderBank] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(!receipt)
  const input = useRef(null)
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  const pick = (chosen) => {
    setError('')
    if (!chosen) return
    if (!ACCEPT.split(',').includes(chosen.type)) { setError('Use a JPG or PNG screenshot, or a PDF. (iPhone HEIC photos: take a screenshot instead.)'); return }
    if (chosen.size > 5 * 1024 * 1024) { setError('That file is bigger than 5 MB. A screenshot is usually much smaller.'); return }
    if (preview) URL.revokeObjectURL(preview)
    setFile(chosen)
    setPreview(chosen.type.startsWith('image/') ? URL.createObjectURL(chosen) : '')
  }
  const submit = async (event) => {
    event.preventDefault()
    if (!file) { setError('Choose your receipt first.'); return }
    setBusy(true); setError('')
    const form = new FormData()
    form.append('receipt', file)
    if (senderName.trim()) form.append('senderName', senderName.trim())
    if (senderBank.trim()) form.append('senderBank', senderBank.trim())
    try {
      const response = await fetch(`${apiBase}/api/payments/orders/${orderId}/bank-transfer/receipt`, { method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: form })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.message || 'Could not upload the receipt. Try again.')
      setFile(null); setPreview(''); setOpen(false)
      onUploaded(body.receipt)
    } catch (uploadError) { setError(uploadError instanceof TypeError ? 'No connection. Your receipt was not sent — try again.' : uploadError.message) } finally { setBusy(false) }
  }

  if (receipt && !open) return <div className="bt-receipt-done">
    <span className="bt-receipt-icon"><CheckCircle2 size={20} aria-hidden="true" /></span>
    <div><strong>Receipt sent</strong><small>Uploaded {clock(receipt.uploadedAt)}{receipt.senderName ? ` · from ${receipt.senderName}` : ''}. DOORSTEP is checking it against the bank account.</small></div>
    <button type="button" className="bt-link" onClick={() => setOpen(true)}>Send another</button>
  </div>

  return <form className="bt-receipt" onSubmit={submit}>
    <h3><ImageUp size={18} aria-hidden="true" />Sent the money? Upload your receipt</h3>
    <p>A screenshot from your bank app helps us confirm your order faster.</p>
    <button type="button" className={`bt-drop${file ? ' has-file' : ''}`} onClick={() => input.current?.click()}>
      {preview ? <img src={preview} alt="Receipt preview" /> : file ? <><FileText size={26} aria-hidden="true" /><b>{file.name}</b></> : <><Upload size={24} aria-hidden="true" /><b>Choose screenshot or PDF</b><small>JPG, PNG or PDF · up to 5 MB</small></>}
    </button>
    <input ref={input} type="file" accept={ACCEPT} hidden onChange={(event) => { pick(event.target.files?.[0]); event.target.value = '' }} />
    {file && <button type="button" className="bt-link" onClick={() => { setFile(null); setPreview('') }}>Choose a different file</button>}
    <div className="bt-fields">
      <label>Name on the sending account <span>(optional)</span><input value={senderName} maxLength={120} onChange={(event) => setSenderName(event.target.value)} placeholder="e.g. Fejiro Eyedo" /></label>
      <label>Your bank <span>(optional)</span><input value={senderBank} maxLength={80} onChange={(event) => setSenderBank(event.target.value)} placeholder="e.g. OPay, GTBank" /></label>
    </div>
    {error && <p className="bt-error" role="alert">{error}</p>}
    <div className="bt-actions">
      <button type="submit" className="bt-primary" disabled={busy || !file}>{busy ? 'Uploading…' : 'Send receipt'}</button>
      {receipt && <button type="button" className="bt-ghost" onClick={() => setOpen(false)}>Cancel</button>}
    </div>
  </form>
}

/** The transfer panel; the page frame (header, tab bar) comes from the caller. */
export function BankTransferPanel({ orderId }) {
  const [payment, setPayment] = useState(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')
  const [checking, setChecking] = useState(false)
  const [checkedAt, setCheckedAt] = useState(null)
  const [checkNote, setCheckNote] = useState('')
  const [now, setNow] = useState(Date.now())
  const previous = useRef(null)

  const load = useCallback(async ({ manual = false } = {}) => {
    if (!token()) { setError('Sign in to view this payment.'); return }
    if (manual) { setChecking(true); setCheckNote('') }
    try {
      const response = await fetch(`${apiBase}/api/payments/orders/${orderId}/bank-transfer`, { headers: { Authorization: `Bearer ${token()}` } })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error === 'BANK_TRANSFER_NOT_FOUND' ? 'This order isn’t paid by bank transfer.' : 'Could not load the transfer details. Check your connection and try again.')
      const changed = previous.current && previous.current !== body.status
      previous.current = body.status
      setPayment(body); setError(''); setCheckedAt(Date.now())
      if (changed && body.status === 'SUCCESSFUL') { try { navigator.vibrate?.(200) } catch { /* unsupported */ } }
      if (manual) setCheckNote(body.status === 'PENDING_VERIFICATION'
        ? (body.receipt ? 'Not confirmed yet. Your receipt is with DOORSTEP — we’re matching it to our bank account.' : 'Not confirmed yet. If you’ve already sent the money, upload your receipt below to speed things up.')
        : '')
    } catch (loadError) { setError(loadError instanceof TypeError ? 'No connection. We’ll keep trying.' : loadError.message) } finally { if (manual) setChecking(false) }
  }, [orderId])

  useEffect(() => { load() }, [load])
  // While waiting, check by itself every 20 s (when the page is visible) and keep the countdown fresh.
  useEffect(() => {
    if (payment && payment.status !== 'PENDING_VERIFICATION') return undefined
    const poll = window.setInterval(() => { if (!document.hidden) load() }, AUTO_CHECK_MS)
    const tick = window.setInterval(() => setNow(Date.now()), 15_000)
    const onVisible = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.clearInterval(poll); window.clearInterval(tick); document.removeEventListener('visibilitychange', onVisible) }
  }, [payment?.status, load])

  const copy = async (key, value) => {
    try { await navigator.clipboard.writeText(String(value)); setCopied(key); window.setTimeout(() => setCopied((current) => current === key ? '' : current), 2000) } catch { setCopied('') }
  }

  if (!payment) return <section className="bt-card">
    <span className="bt-kicker">BANK TRANSFER</span>
    <h2>{error ? 'Couldn’t load your transfer' : 'Getting your payment details…'}</h2>
    {error && <><p className="bt-error" role="alert">{error}</p><button type="button" className="bt-primary" onClick={() => load({ manual: true })}>Try again</button></>}
  </section>

  const state = STATUS[payment.status] || STATUS.PENDING_VERIFICATION
  const Icon = state.icon
  const waiting = payment.status === 'PENDING_VERIFICATION'
  const left = waiting && payment.expiresAt ? timeLeft(payment.expiresAt, now) : null
  const details = payment.instructions
  const amount = formatNaira(Math.round(payment.amountMinor / 100))

  return <section className="bt-card">
      <span className="bt-kicker">BANK TRANSFER · {payment.orderNumber}</span>
      <div className={`bt-status is-${state.tone}`}><Icon size={22} aria-hidden="true" /><div><strong>{state.title}</strong>
        <small>{waiting ? (payment.receipt ? 'Receipt received — DOORSTEP is confirming your payment.' : left ? `Send ${amount} within ${left}. We confirm it by hand, usually within a few minutes.` : 'Send the exact amount below.')
          : payment.status === 'SUCCESSFUL' ? 'The store has your order now.'
            : payment.status === 'EXPIRED' ? 'This order was not paid in time. If you already sent money, contact DOORSTEP Help with your receipt.'
              : 'If you sent money, contact DOORSTEP Help with your receipt so we can sort it out.'}</small></div></div>

      {waiting && details && <>
        <p className="bt-lead">Send exactly <b>{amount}</b> to this account:</p>
        <dl className="bt-details">
          <CopyRow label="Bank" value={details.bankName} />
          <CopyRow label="Account number" value={details.accountNumber} strong copied={copied === 'account'} onCopy={() => copy('account', details.accountNumber)} />
          <CopyRow label="Account name" value={details.accountName} />
          <CopyRow label="Amount" value={Math.round(payment.amountMinor / 100)} display={amount} strong copied={copied === 'amount'} onCopy={() => copy('amount', Math.round(payment.amountMinor / 100))} />
          <CopyRow label="Reference / narration" value={payment.reference} copied={copied === 'reference'} onCopy={() => copy('reference', payment.reference)} />
        </dl>
        {details.message && <p className="bt-note"><Landmark size={15} aria-hidden="true" />{details.message}</p>}
        <p className="bt-note">Put the reference in the transfer narration if your bank allows it. Pay the exact amount: a different amount can delay your order.</p>
      </>}
      {waiting && !details && <p className="bt-error">These transfer details are no longer available. Contact DOORSTEP Help with your order number.</p>}

      {waiting && <ReceiptForm orderId={payment.orderId || orderId} receipt={payment.receipt} onUploaded={(receipt) => { setPayment((current) => ({ ...current, receipt })); setCheckNote('') }} />}

      {checkNote && <p className="bt-check-note" role="status">{checkNote}</p>}
      <div className="bt-actions">
        {waiting && <button type="button" className="bt-primary" disabled={checking} onClick={() => load({ manual: true })}><RefreshCw size={16} className={checking ? 'is-spinning' : ''} aria-hidden="true" />{checking ? 'Checking…' : 'Check payment status'}</button>}
        {payment.status === 'SUCCESSFUL' && <button type="button" className="bt-primary" onClick={() => navigate(`/account/orders/${orderId}`)}>Track my order <ArrowRight size={16} aria-hidden="true" /></button>}
        <button type="button" className="bt-ghost" onClick={() => navigate(`/account/orders/${orderId}`)}>View order</button>
        {!waiting && payment.status !== 'SUCCESSFUL' && <button type="button" className="bt-ghost" onClick={() => navigate('/help')}>Get help</button>}
      </div>
      {waiting && checkedAt && <p className="bt-checked">Checked {clock(checkedAt)} · we check again automatically while this page is open.</p>}
  </section>
}
