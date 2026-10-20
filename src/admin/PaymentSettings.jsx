import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BadgeCheck, Banknote, Check, Clock3, Copy, CreditCard, Inbox, Landmark, RefreshCw, Save, ShieldCheck, X } from 'lucide-react'
import { apiBase } from '../config/apiBase'

// Admin › Payment methods: Paystack status, the DOORSTEP bank account customers transfer to (checked against the
// bank's records), and the queue of transfers an admin must confirm by hand.

const token = () => { try { return localStorage.getItem('doorstep-admin-token') } catch { return null } }
async function call(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${apiBase}${path}`, { method, headers: { Authorization: `Bearer ${token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(data.message || 'Something went wrong. Try again.'), { code: data.error })
  return data
}
const money = (minor) => `₦${((minor || 0) / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`
const ago = (value) => {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`
  return new Date(value).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })
}
const EXPIRY_CHOICES = [[30, '30 min'], [60, '1 hour'], [180, '3 hours'], [1440, '24 hours'], [null, 'No limit']]
const DEFAULT_INSTRUCTIONS = 'Transfer the exact amount and put your DOORSTEP reference in the narration/remark. We confirm your payment as soon as it arrives.'
const normal = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')

function Copyable({ value, label }) {
  const [copied, setCopied] = useState(false)
  return <button type="button" className="ps-copy" onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard blocked */ } }} aria-label={`Copy ${label}`}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy'}</button>
}

function Toggle({ checked, onChange, label }) {
  return <label className="ps-toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span aria-hidden="true" /><b>{label}</b></label>
}

function TransferRow({ payment, onDone }) {
  const [mode, setMode] = useState(null)
  const [form, setForm] = useState({ bankTransactionId: '', note: '', reason: 'NOT_RECEIVED' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const owner = payment.order?.customer || payment.parcelBooking?.customer
  const what = payment.order ? `${payment.order.orderNumber}${payment.order.restaurant?.name ? ` · ${payment.order.restaurant.name}` : ''}` : payment.parcelBooking ? `Package ${payment.parcelBooking.reference}` : 'Payment'
  const expired = payment.expiresAt && new Date(payment.expiresAt) < new Date()
  const pending = payment.status === 'PENDING_VERIFICATION'
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError('')
    try {
      if (mode === 'confirm') await call(`/api/admin/bank-transfers/${payment.id}/confirm`, { method: 'POST', body: { bankTransactionId: form.bankTransactionId, note: form.note || 'Checked the DOORSTEP bank account; amount and reference match.' } })
      else await call(`/api/admin/bank-transfers/${payment.id}/reject`, { method: 'POST', body: { reason: form.reason, note: form.note } })
      onDone()
    } catch (submitError) { setError(submitError.message); setBusy(false) }
  }
  return <li className="ps-transfer">
    <div className="ps-transfer-main">
      <div><strong className="ps-amount">{money(payment.amountMinor)}</strong><small>{what}</small></div>
      <span className={`ps-status is-${payment.status.toLowerCase()}`}>{pending ? (expired ? 'Overdue' : 'Waiting') : payment.status === 'SUCCESSFUL' ? 'Confirmed' : payment.status === 'AMOUNT_MISMATCH' ? 'Wrong amount' : payment.status === 'EXPIRED' ? 'Expired' : 'Not received'}</span>
    </div>
    <dl className="ps-facts">
      <div><dt>Reference</dt><dd><code>{payment.reference}</code><Copyable value={payment.reference} label="reference" /></dd></div>
      {owner && <div><dt>Customer</dt><dd>{`${owner.firstName || ''} ${owner.lastName || ''}`.trim() || owner.email}{owner.phone ? <> · <a href={`tel:${owner.phone}`}>{owner.phone}</a></> : null}</dd></div>}
      <div><dt>Started</dt><dd>{ago(payment.createdAt)}{payment.expiresAt && pending ? ` · ${expired ? 'expired' : 'expires'} ${new Date(payment.expiresAt).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' })}` : ''}</dd></div>
    </dl>
    {pending && !mode && <div className="ps-actions"><button type="button" className="ps-primary" onClick={() => setMode('confirm')}><Check size={16} />Money received</button><button type="button" className="ps-ghost" onClick={() => setMode('reject')}><X size={16} />Not received</button></div>}
    {mode && <form className="ps-form" onSubmit={submit}>
      {mode === 'confirm' ? <>
        <p className="ps-hint">Open your bank app, find a credit of <b>{money(payment.amountMinor)}</b> with reference <b>{payment.reference}</b>, and copy its transaction or session ID.</p>
        <label className="ps-field"><span>Bank transaction / session ID</span><input required minLength={3} maxLength={160} value={form.bankTransactionId} onChange={(event) => setForm({ ...form, bankTransactionId: event.target.value })} placeholder="e.g. 100004241020153000123456789" /></label>
        <label className="ps-field"><span>Note (optional)</span><input maxLength={1000} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="Sender name, time seen" /></label>
      </> : <>
        <div className="ps-chips" role="radiogroup" aria-label="What happened">{[['NOT_RECEIVED', 'No money arrived'], ['WRONG_AMOUNT', 'Wrong amount arrived']].map(([value, label]) => <button type="button" key={value} role="radio" aria-checked={form.reason === value} className={form.reason === value ? 'is-on' : ''} onClick={() => setForm({ ...form, reason: value })}>{label}</button>)}</div>
        <label className="ps-field"><span>What you checked</span><input required minLength={3} maxLength={1000} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder={form.reason === 'WRONG_AMOUNT' ? 'e.g. received ₦5,000 instead of ₦9,350' : 'e.g. checked OPay history until 4:30pm'} /></label>
        <p className="ps-hint">The order is closed and the customer is told{form.reason === 'WRONG_AMOUNT' ? '. Send back what they paid from your bank app.' : '.'}</p>
      </>}
      {error && <p className="ps-error" role="alert">{error}</p>}
      <div className="ps-actions"><button type="submit" className={mode === 'confirm' ? 'ps-primary' : 'ps-danger'} disabled={busy}>{busy ? 'Saving…' : mode === 'confirm' ? 'Confirm payment' : 'Close order'}</button><button type="button" className="ps-ghost" disabled={busy} onClick={() => { setMode(null); setError('') }}>Cancel</button></div>
    </form>}
  </li>
}

function TransferQueue({ onCount }) {
  const [view, setView] = useState('PENDING_VERIFICATION')
  const [payments, setPayments] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setError('')
    try {
      const data = await call(`/api/admin/bank-transfers${view ? `?status=${view}` : ''}`)
      setPayments(data.payments)
      if (view === 'PENDING_VERIFICATION') onCount?.(data.payments.length)
    } catch (loadError) { setError(loadError.message) }
  }, [view, onCount])
  useEffect(() => { load() }, [load])
  return <section className="ps-card" aria-labelledby="ps-queue">
    <header className="ps-card-head"><Inbox size={20} aria-hidden="true" /><div><h2 id="ps-queue">Transfers to confirm</h2><p>Bank transfers only reach the store after you confirm the money is in your account.</p></div><button type="button" className="ps-icon" onClick={load} aria-label="Refresh"><RefreshCw size={17} /></button></header>
    <div className="ps-chips">{[['PENDING_VERIFICATION', 'Waiting'], ['', 'All recent']].map(([value, label]) => <button type="button" key={label} className={view === value ? 'is-on' : ''} onClick={() => { setPayments(null); setView(value) }}>{label}</button>)}</div>
    {error && <p className="ps-error" role="alert">{error}</p>}
    {!payments && !error && <p className="ps-muted">Loading…</p>}
    {payments?.length === 0 && <p className="ps-empty"><BadgeCheck size={18} aria-hidden="true" />{view ? 'Nothing waiting. You’re all caught up.' : 'No bank transfers yet.'}</p>}
    {payments?.length > 0 && <ul className="ps-transfers">{payments.map((payment) => <TransferRow key={payment.id} payment={payment} onDone={load} />)}</ul>}
  </section>
}

export function PaymentSettingsAdmin() {
  const [loaded, setLoaded] = useState(null)
  const [bank, setBank] = useState(null)
  const [banks, setBanks] = useState([])
  const [bankListError, setBankListError] = useState(false)
  const [lookup, setLookup] = useState({ state: 'idle', name: '', error: '' })
  const [waiting, setWaiting] = useState(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState({ tone: '', text: '' })

  useEffect(() => {
    call('/api/admin/payment-settings').then((data) => { setLoaded(data); setBank({ ...data.settings.bankTransfer, bankCode: data.settings.bankTransfer.bankCode || '' }); setWaiting(data.transfers?.waiting ?? null) }).catch((error) => setMessage({ tone: 'error', text: error.message }))
    call('/api/finance/banks').then((data) => setBanks(data.banks || [])).catch(() => setBankListError(true))
  }, [])

  // Match an old free-text bank name ("opay") to the official bank list once it arrives.
  useEffect(() => {
    if (!bank || bank.bankCode || !banks.length || !bank.bankName) return
    const wanted = normal(bank.bankName)
    const match = banks.find((entry) => normal(entry.name) === wanted) || banks.find((entry) => normal(entry.name).includes(wanted) && wanted.length >= 4)
    if (match) setBank((current) => ({ ...current, bankCode: match.code, bankName: match.name }))
  }, [banks, bank?.bankName])

  const digits = (bank?.accountNumber || '').replace(/\D/g, '')
  const phoneLike = /^0\d{10}$/.test(digits)
  const numberOk = /^\d{10}$/.test(digits)
  const savedSettings = loaded?.settings.bankTransfer
  const dirty = useMemo(() => savedSettings && bank && ['enabled', 'bankName', 'bankCode', 'accountName', 'accountNumber', 'instructions', 'expiryMinutes'].some((key) => (bank[key] ?? '') !== (savedSettings[key] ?? '')), [bank, savedSettings])
  const verifiedName = lookup.state === 'ok' ? lookup.name : savedSettings?.accountVerifiedAt && savedSettings.accountNumber === digits && savedSettings.bankCode === bank?.bankCode ? savedSettings.accountName : ''

  if (!loaded || !bank) return <section className="ps"><div className="ps-card">{message.text ? <p className="ps-error">{message.text}</p> : 'Loading payment settings…'}</div></section>
  const update = (patch) => { setBank((current) => ({ ...current, ...patch })); setMessage({ tone: '', text: '' }) }
  const paystack = loaded.paystack

  const checkName = async () => {
    setLookup({ state: 'busy', name: '', error: '' })
    try {
      const data = await call('/api/admin/payment-settings/resolve-account', { method: 'POST', body: { bankCode: bank.bankCode, accountNumber: digits } })
      setLookup({ state: 'ok', name: data.accountName, error: '' })
      update({ accountName: data.accountName })
    } catch (error) { setLookup({ state: 'error', name: '', error: error.message }) }
  }

  const save = async () => {
    setSaving(true); setMessage({ tone: '', text: '' })
    try {
      const { accountVerifiedAt, ...rest } = bank
      const body = { bankTransfer: { ...rest, accountNumber: digits || rest.accountNumber, bankCode: rest.bankCode || undefined, currency: 'NGN', verificationMethod: 'MANUAL', automaticVerification: false }, cashOnDelivery: loaded.settings.cashOnDelivery || { enabled: false } }
      const data = await call('/api/admin/payment-settings', { method: 'PATCH', body })
      setLoaded((current) => ({ ...current, settings: data.settings }))
      setBank({ ...data.settings.bankTransfer, bankCode: data.settings.bankTransfer.bankCode || '' })
      setMessage({ tone: 'ok', text: data.nameCorrected ? `Saved. The account name was updated to match the bank: ${data.settings.bankTransfer.accountName}.` : data.settings.bankTransfer.accountVerifiedAt ? 'Saved. Account checked with the bank.' : 'Saved.' })
    } catch (error) { setMessage({ tone: 'error', text: error.message }) } finally { setSaving(false) }
  }

  return <section className="ps">
    <header className="ps-hero">
      <span className="ps-kicker">PAYMENTS</span>
      <h1>How customers pay you</h1>
      <div className="ps-hero-chips">
        <span className={paystack.configured ? 'is-on' : ''}><CreditCard size={14} />Paystack {paystack.configured ? (paystack.mode === 'live' ? 'live' : 'test mode') : 'off'}</span>
        <span className={bank.enabled && savedSettings.enabled ? 'is-on' : ''}><Landmark size={14} />Bank transfer {savedSettings.enabled ? 'on' : 'off'}</span>
        {waiting > 0 && <span className="is-warn"><Clock3 size={14} />{waiting} to confirm</span>}
      </div>
    </header>

    {savedSettings.enabled && !/^\d{10}$/.test(String(savedSettings.accountNumber || '').replace(/\s/g, '')) && <div className="ps-card ps-alert" role="alert"><AlertTriangle size={20} aria-hidden="true" /><div><b>Customers are being shown an account number that can’t receive money.</b><p>{String(savedSettings.accountNumber).replace(/\s/g, '').length} digits saved — Nigerian account numbers have 10.{/^0\d{10}$/.test(String(savedSettings.accountNumber).replace(/\s/g, '')) ? ' For OPay it is your phone number without the first 0.' : ''} Fix it below and save.</p></div></div>}

    <section className="ps-card" aria-labelledby="ps-paystack">
      <header className="ps-card-head"><CreditCard size={20} aria-hidden="true" /><div><h2 id="ps-paystack">Paystack</h2><p>Card, bank transfer and USSD through Paystack checkout. Confirmed automatically — no checking needed.</p></div><span className={`ps-badge ${paystack.configured ? (paystack.mode === 'live' ? 'is-live' : 'is-test') : ''}`}>{paystack.configured ? (paystack.mode === 'live' ? 'Live' : 'Test') : 'Not set up'}</span></header>
      {!paystack.configured && <p className="ps-muted">Add the Paystack secret key in Render → Environment, then redeploy. The key is never shown or typed here.</p>}
      {paystack.configured && <div className="ps-webhook"><span>Webhook URL</span><div><code>{paystack.webhookUrl}</code><Copyable value={paystack.webhookUrl} label="webhook URL" /></div><small>Paste it in Paystack → Settings → API Keys &amp; Webhooks so payments, refunds and payouts update even if a customer closes the page.</small></div>}
    </section>

    <TransferQueue onCount={setWaiting} />

    <section className="ps-card" aria-labelledby="ps-bank">
      <header className="ps-card-head"><Banknote size={20} aria-hidden="true" /><div><h2 id="ps-bank">Direct bank transfer</h2><p>Customers transfer straight to your account and you confirm each payment above.</p></div></header>
      <Toggle checked={bank.enabled} onChange={(enabled) => update({ enabled })} label={bank.enabled ? 'Offered at checkout' : 'Not offered at checkout'} />

      <label className="ps-field"><span>Bank</span>
        {banks.length > 0 ? <select value={bank.bankCode} onChange={(event) => { const choice = banks.find((entry) => entry.code === event.target.value); update({ bankCode: choice?.code || '', bankName: choice?.name || '' }); setLookup({ state: 'idle', name: '', error: '' }) }}>
          <option value="">Choose your bank</option>{banks.map((entry) => <option key={entry.code} value={entry.code}>{entry.name}</option>)}
        </select> : <input value={bank.bankName} maxLength={120} onChange={(event) => update({ bankName: event.target.value })} placeholder="e.g. OPay" />}
        {bankListError && <small>Bank list unavailable, so the account name can’t be checked automatically.</small>}
      </label>

      <label className="ps-field"><span>Account number</span>
        <div className="ps-account"><input inputMode="numeric" autoComplete="off" maxLength={14} value={bank.accountNumber} onChange={(event) => { update({ accountNumber: event.target.value.replace(/[^\d ]/g, '') }); setLookup({ state: 'idle', name: '', error: '' }) }} placeholder="10 digits" /><i className={numberOk ? 'is-ok' : ''}>{digits.length}/10</i></div>
        {phoneLike && <span className="ps-fix"><AlertTriangle size={14} aria-hidden="true" />That’s 11 digits — a phone number. OPay/PalmPay/Moniepoint account numbers drop the first 0.<button type="button" onClick={() => update({ accountNumber: digits.slice(1) })}>Use {digits.slice(1)}</button></span>}
      </label>

      {bank.bankCode && numberOk && paystack.configured && <button type="button" className="ps-ghost ps-check" onClick={checkName} disabled={lookup.state === 'busy'}><ShieldCheck size={16} />{lookup.state === 'busy' ? 'Checking with the bank…' : 'Check account name'}</button>}
      {lookup.state === 'error' && <p className="ps-error" role="alert">{lookup.error}</p>}
      {verifiedName && <p className="ps-verified"><BadgeCheck size={16} aria-hidden="true" />Bank confirms: <b>{verifiedName}</b></p>}

      <label className="ps-field"><span>Account name</span><input value={bank.accountName} maxLength={160} onChange={(event) => update({ accountName: event.target.value })} placeholder="As shown by your bank" /><small>When the bank is chosen from the list, this is checked and corrected on save.</small></label>

      <label className="ps-field"><span>Message to customers</span><textarea rows={3} maxLength={1000} value={bank.instructions} onChange={(event) => update({ instructions: event.target.value })} placeholder={DEFAULT_INSTRUCTIONS} />{!bank.instructions && <button type="button" className="ps-link" onClick={() => update({ instructions: DEFAULT_INSTRUCTIONS })}>Use suggested message</button>}</label>

      <fieldset className="ps-field ps-expiry"><legend>Time to pay</legend><div className="ps-chips">{EXPIRY_CHOICES.map(([value, label]) => <button type="button" key={label} className={(bank.expiryMinutes ?? null) === value ? 'is-on' : ''} onClick={() => update({ expiryMinutes: value })}>{label}</button>)}</div><small>Unpaid transfers close after this, so food isn’t held for orders that never get paid.</small></fieldset>

      <div className="ps-preview" aria-label="What customers see">
        <span className="ps-kicker is-dark">CUSTOMER SEES</span>
        <div><small>Bank</small><b>{bank.bankName || '—'}</b></div>
        <div><small>Account number</small><b className="ps-mono">{digits || '—'}</b></div>
        <div><small>Account name</small><b>{bank.accountName || '—'}</b></div>
        <div><small>Reference</small><b className="ps-mono">DSPTRF-XXXXXXXX</b></div>
        {bank.instructions && <p>{bank.instructions}</p>}
      </div>
    </section>

    <div className="ps-savebar">
      <span className={message.tone === 'error' ? 'ps-error' : message.tone === 'ok' ? 'ps-ok' : ''}>{message.text || (dirty ? 'Unsaved changes' : 'All changes saved')}</span>
      <div>{dirty && <button type="button" className="ps-ghost" disabled={saving} onClick={() => { setBank({ ...savedSettings, bankCode: savedSettings.bankCode || '' }); setLookup({ state: 'idle', name: '', error: '' }); setMessage({ tone: '', text: '' }) }}>Discard</button>}<button type="button" className="ps-primary" disabled={saving || !dirty} onClick={save}><Save size={16} />{saving ? 'Saving…' : 'Save'}</button></div>
    </div>
  </section>
}
