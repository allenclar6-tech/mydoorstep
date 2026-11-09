import { useCallback, useEffect, useState } from 'react'
import { Check, MapPin, RefreshCw, Store } from 'lucide-react'
import { apiBase } from '../config/apiBase'
import './priceChecks.css'

// Rider › Price checks: DOORSTEP asks riders what a trip to a hard-to-map place should pay. Riders agree with the
// suggested pay, give their own price, or pass. DOORSTEP decides the final rider pay and customer price; customers
// never take part. The rider who agreed the chosen price is offered the job first.

const token = () => { try { return localStorage.getItem('doorstep-token') } catch { return null } }
const naira = (minor) => minor == null ? '—' : `₦${Math.round(minor / 100).toLocaleString('en-NG')}`
const ago = (iso) => { const minutes = Math.max(1, Math.round((Date.now() - new Date(iso)) / 60000)); return minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago` }
const ANSWER_TEXT = { AGREE: 'You agreed', COUNTER: 'Your price', DECLINE: 'You passed' }

function CheckCard({ check, onSaved }) {
  const [mode, setMode] = useState(null)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [state, setState] = useState({ busy: false, error: '' })
  const answer = async (response) => {
    const amountMinor = response === 'COUNTER' ? Math.round(Number(amount) * 100) : undefined
    if (response === 'COUNTER' && !(amountMinor >= 10_000)) { setState({ busy: false, error: 'Type your price in naira, e.g. 1500.' }); return }
    setState({ busy: true, error: '' })
    try {
      const result = await fetch(`${apiBase}/api/rider/price-checks/${encodeURIComponent(check.id)}`, { method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ response, ...(amountMinor ? { amountMinor } : {}), ...(note.trim() ? { note: note.trim() } : {}) }) })
      const body = await result.json().catch(() => ({}))
      if (!result.ok) throw new Error(body.message || 'Your answer wasn’t sent. Try again.')
      setMode(null); setState({ busy: false, error: '' }); onSaved()
    } catch (error) { setState({ busy: false, error: error instanceof TypeError ? 'No internet. Your answer wasn’t sent.' : error.message }) }
  }
  const mine = check.myAnswer

  return <article className="pc-card">
    <header className="pc-card-head">
      <span className="pc-order">{check.orderNumber}</span>
      <time dateTime={check.askedAt}>{ago(check.askedAt)}</time>
    </header>

    <ol className="pc-route" aria-label="Trip">
      <li><Store size={16} aria-hidden="true" /><span><b>{check.store.name}</b><small>{check.store.address}</small></span></li>
      <li><MapPin size={16} aria-hidden="true" /><span><b>{check.dropoffArea || 'Drop-off area not mapped'}</b><small>{check.landmark ? `Near ${check.landmark}` : 'No landmark given'}</small></span></li>
    </ol>

    <dl className="pc-facts">
      <div><dt>Distance</dt><dd>{check.km != null && check.kmMeasured ? `About ${check.km} km` : 'Not measured'}</dd></div>
      <div><dt>DOORSTEP suggests</dt><dd>{check.suggestedPayMinor != null ? naira(check.suggestedPayMinor) : 'Your price'}</dd></div>
    </dl>
    {check.note && <p className="pc-note">{check.note}</p>}

    {mine && !mode && <p className={`pc-mine is-${mine.response.toLowerCase()}`}><Check size={15} aria-hidden="true" />{ANSWER_TEXT[mine.response]}{mine.amountMinor != null ? ` ${naira(mine.amountMinor)}` : ''}{mine.note ? ` · “${mine.note}”` : ''}</p>}

    {mode === 'counter' ? <div className="pc-form">
      <label>Your price for this trip (₦)<input inputMode="numeric" autoFocus value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^\d]/g, '').slice(0, 6))} placeholder="e.g. 1500" /></label>
      <label>Why (optional)<input maxLength={200} value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Bad road after the bridge" /></label>
      <div className="pc-actions">
        <button type="button" className="pc-btn is-primary" disabled={state.busy} onClick={() => answer('COUNTER')}>{state.busy ? 'Sending…' : 'Send my price'}</button>
        <button type="button" className="pc-btn" disabled={state.busy} onClick={() => setMode(null)}>Cancel</button>
      </div>
    </div> : <div className="pc-actions">
      {check.suggestedPayMinor != null && <button type="button" className="pc-btn is-primary" disabled={state.busy} onClick={() => answer('AGREE')}>{state.busy ? 'Sending…' : `OK at ${naira(check.suggestedPayMinor)}`}</button>}
      <button type="button" className={`pc-btn${check.suggestedPayMinor == null ? ' is-primary' : ''}`} disabled={state.busy} onClick={() => { setAmount(mine?.amountMinor ? String(Math.round(mine.amountMinor / 100)) : ''); setNote(mine?.note || ''); setMode('counter') }}>{check.suggestedPayMinor == null ? 'Give my price' : 'Suggest another price'}</button>
      <button type="button" className="pc-btn is-quiet" disabled={state.busy} onClick={() => answer('DECLINE')}>Not for me</button>
    </div>}
    {state.error && <p className="pc-error" role="alert">{state.error}</p>}
  </article>
}

export function PriceChecks() {
  const [checks, setChecks] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(() => {
    setError('')
    fetch(`${apiBase}/api/rider/price-checks`, { headers: { Authorization: `Bearer ${token()}` } })
      .then(async (response) => { const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(response.status === 403 ? 'Price checks are for approved DOORSTEP riders.' : 'Couldn’t load price checks.'); setChecks(body.checks || []) })
      .catch((loadError) => setError(loadError instanceof TypeError ? 'No internet. Pull to refresh when you’re back online.' : loadError.message))
  }, [])
  useEffect(() => { load() }, [load])

  return <section className="pc" aria-labelledby="pc-title">
    <header className="pc-intro">
      <div>
        <h2 id="pc-title">Price checks</h2>
        <p>DOORSTEP is setting prices for trips to places the map can’t measure. Tell us what’s fair. If your price is chosen, you get first offer of the job.</p>
      </div>
      <button type="button" className="pc-btn is-icon" onClick={load} aria-label="Refresh"><RefreshCw size={17} /></button>
    </header>
    {error && <p className="pc-error" role="alert">{error}</p>}
    {!checks && !error && <div className="pc-skeleton" role="status" aria-label="Loading price checks"><span /><span /></div>}
    {checks && !checks.length && <div className="pc-empty"><b>No price checks right now</b><p>When DOORSTEP needs your view on a trip price, it will appear here and you’ll get a notification.</p></div>}
    {checks?.map((check) => <CheckCard key={check.id} check={check} onSaved={load} />)}
  </section>
}
