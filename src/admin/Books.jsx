import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Bike, Building2, ChevronRight, Download, Printer, RefreshCw } from 'lucide-react'
import { apiBase } from '../config/apiBase'
import './books.css'

// Admin › Books & statements. One place for DOORSTEP's bookkeeping:
//  • the books for a period (money in, DOORSTEP's income, money paid out, what's owed, refunds owed)
//  • who DOORSTEP owes, riders and businesses listed separately, with unpaid jobs per person
//  • each rider's / business's statement (opening balance, every job with its fees, payouts, closing balance)
//  • CSV downloads for each statement and the full journal (for an accountant).
// Payments themselves are made in Money & payouts; this page is the record.

const token = () => { try { return localStorage.getItem('doorstep-admin-token') } catch { return null } }
async function call(path) {
  const response = await fetch(`${apiBase}${path}`, { headers: { Authorization: `Bearer ${token()}` } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(body.message || (response.status === 401 ? 'You’ve been signed out. Sign in again.' : 'This couldn’t be loaded. Try again.')), { status: response.status })
  return body
}
async function download(path, fallbackName) {
  const response = await fetch(`${apiBase}${path}`, { headers: { Authorization: `Bearer ${token()}` } })
  if (!response.ok) throw new Error('The download didn’t work. Try again.')
  const name = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') || '')?.[1] || fallbackName
  const url = URL.createObjectURL(await response.blob())
  const link = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.append(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const money = (minor) => minor == null ? '—' : `${minor < 0 ? '−' : ''}₦${(Math.abs(Math.round(minor)) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const dateText = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const timeText = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const lagosDay = (date) => new Date(date.getTime() + 3_600_000).toISOString().slice(0, 10)
function presets() {
  const now = new Date(Date.now() + 3_600_000)
  const y = now.getUTCFullYear(); const m = now.getUTCMonth()
  const iso = (d) => d.toISOString().slice(0, 10)
  return [
    ['month', 'This month', { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(now) }],
    ['last', 'Last month', { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))) }],
    ['7', 'Last 7 days', { from: lagosDay(new Date(Date.now() - 6 * 86_400_000)), to: iso(now) }],
    ['year', 'This year', { from: `${y}-01-01`, to: iso(now) }],
  ]
}

function PeriodPicker({ period, onChange }) {
  const options = useMemo(presets, [])
  const active = options.find(([, , range]) => range.from === period.from && range.to === period.to)?.[0] || 'custom'
  return <div className="bk-period" role="group" aria-label="Period">
    <div className="bk-seg">{options.map(([key, label, range]) => <button key={key} type="button" aria-pressed={active === key} onClick={() => onChange(range)}>{label}</button>)}</div>
    <div className="bk-dates">
      <label><span>From</span><input type="date" value={period.from} max={period.to} onChange={(event) => event.target.value && onChange({ ...period, from: event.target.value })} /></label>
      <label><span>To</span><input type="date" value={period.to} min={period.from} onChange={(event) => event.target.value && onChange({ ...period, to: event.target.value })} /></label>
    </div>
  </div>
}

function Summary({ period }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { setData(null); setError(''); call(`/api/admin/books/summary?from=${period.from}&to=${period.to}`).then(setData).catch((loadError) => setError(loadError.message)) }, [period.from, period.to])
  if (error) return <p className="bk-alert" role="alert">{error}</p>
  if (!data) return <div className="bk-skeleton" role="status" aria-label="Loading the books"><span /><span /><span /><span /></div>
  const paidOut = data.paidOut.ridersMinor + data.paidOut.businessesMinor + data.paidOut.businessesBySplitMinor
  const owed = data.owedNow.ridersMinor + data.owedNow.businessesMinor
  return <>
    <section className="bk-kpis" aria-label="Summary">
      <div><span>Money in</span><b>{money(data.moneyIn.totalMinor)}</b><small>{data.moneyIn.payments} customer payment{data.moneyIn.payments === 1 ? '' : 's'}</small></div>
      <div><span>DOORSTEP income</span><b>{money(data.income.totalMinor)}</b><small>Commission, fees and delivery</small></div>
      <div><span>Paid out</span><b>{money(paidOut)}</b><small>To riders and businesses</small></div>
      <div className="is-owed"><span>Owed now</span><b>{money(owed)}</b><small>Riders {money(data.owedNow.ridersMinor)} · Businesses {money(data.owedNow.businessesMinor)}</small></div>
    </section>
    <div className="bk-grid">
      <section className="bk-card">
        <h3>DOORSTEP income</h3>
        {data.income.lines.length ? <table className="bk-table is-compact"><tbody>{data.income.lines.map((line) => <tr key={line.type}><th scope="row">{line.label}</th><td>{money(line.amountMinor)}</td></tr>)}</tbody><tfoot><tr><th scope="row">Total</th><td>{money(data.income.totalMinor)}</td></tr></tfoot></table> : <p className="bk-muted">No income recorded in this period.</p>}
      </section>
      <section className="bk-card">
        <h3>Paid out</h3>
        <table className="bk-table is-compact"><tbody>
          <tr><th scope="row">Riders <small>{data.paidOut.riderPayouts} payout{data.paidOut.riderPayouts === 1 ? '' : 's'}</small></th><td>{money(data.paidOut.ridersMinor)}</td></tr>
          <tr><th scope="row">Businesses <small>{data.paidOut.businessPayouts} payout{data.paidOut.businessPayouts === 1 ? '' : 's'}</small></th><td>{money(data.paidOut.businessesMinor)}</td></tr>
          <tr><th scope="row">Businesses, paid at checkout <small>Paystack split</small></th><td>{money(data.paidOut.businessesBySplitMinor)}</td></tr>
        </tbody><tfoot><tr><th scope="row">Total</th><td>{money(paidOut)}</td></tr></tfoot></table>
        {(data.refundsOwed.count > 0 || data.awaitingPrice > 0) && <ul className="bk-flags">
          {data.refundsOwed.count > 0 && <li>{data.refundsOwed.count} customer refund{data.refundsOwed.count === 1 ? '' : 's'} still to pay ({money(data.refundsOwed.amountMinor)})</li>}
          {data.awaitingPrice > 0 && <li>{data.awaitingPrice} rider earning{data.awaitingPrice === 1 ? '' : 's'} waiting for a price (set them in Money &amp; payouts)</li>}
        </ul>}
      </section>
    </div>
  </>
}

function Payees({ period, kind, onOpen }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [onlyOwed, setOnlyOwed] = useState(true)
  const load = useCallback(() => { setData(null); setError(''); call(`/api/admin/books/payees/${kind}?from=${period.from}&to=${period.to}`).then(setData).catch((loadError) => setError(loadError.message)) }, [kind, period.from, period.to])
  useEffect(() => { load() }, [load])
  const rows = (data?.payees || []).filter((row) => !onlyOwed || row.owedNowMinor !== 0 || row.awaitingPrice > 0)
  const Icon = kind === 'rider' ? Bike : Building2
  return <section className="bk-card">
    <header className="bk-card-head">
      <div><h3>{kind === 'rider' ? 'Riders' : 'Businesses'}: what DOORSTEP owes</h3>{data && <p className="bk-muted">Owed now: <b className="bk-num">{money(data.owedTotalMinor)}</b></p>}</div>
      <label className="bk-check"><input type="checkbox" checked={onlyOwed} onChange={(event) => setOnlyOwed(event.target.checked)} />Only those owed</label>
    </header>
    {error && <p className="bk-alert" role="alert">{error} <button type="button" className="bk-link" onClick={load}><RefreshCw size={13} />Try again</button></p>}
    {!data && !error && <div className="bk-skeleton is-rows" role="status" aria-label="Loading"><span /><span /><span /></div>}
    {data && !rows.length && <p className="bk-empty">{onlyOwed ? `No ${kind === 'rider' ? 'rider' : 'business'} is owed anything right now.` : 'Nothing recorded in this period.'}</p>}
    {rows.length > 0 && <table className="bk-table bk-payees">
      <thead><tr><th scope="col">{kind === 'rider' ? 'Rider' : 'Business'}</th><th scope="col">Unpaid jobs</th><th scope="col">Earned in period</th><th scope="col">Paid in period</th><th scope="col">Owed now</th><th scope="col"><span className="bk-sr">Open</span></th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.id} onClick={() => onOpen(row)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') onOpen(row) }}>
        <th scope="row"><span className="bk-who"><Icon size={16} aria-hidden="true" /><span><b>{row.name}</b><small>{row.bank ? `${row.bank.bankName} ••••${row.bank.last4}${row.bank.transfersReady ? '' : ' · not verified'}` : 'No bank account yet'}{row.awaitingPrice ? ` · ${row.awaitingPrice} to price` : ''}</small></span></span></th>
        <td data-label="Unpaid jobs">{row.unpaidJobs}</td>
        <td data-label="Earned in period">{money(row.earnedInPeriodMinor)}</td>
        <td data-label="Paid in period">{money(row.paidInPeriodMinor)}{row.lastPaidAt && <small>last {dateText(row.lastPaidAt)}</small>}</td>
        <td data-label="Owed now" className={`bk-owed ${row.owedNowMinor < 0 ? 'is-negative' : ''}`}>{money(row.owedNowMinor)}</td>
        <td className="bk-go"><ChevronRight size={18} aria-hidden="true" /></td>
      </tr>)}</tbody>
    </table>}
  </section>
}

function Statement({ kind, payee, period, onBack }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setData(null); setError(''); call(`/api/admin/books/statement/${kind}/${payee.id}?from=${period.from}&to=${period.to}`).then(setData).catch((loadError) => setError(loadError.message)) }, [kind, payee.id, period.from, period.to])
  const csv = async () => { setBusy(true); try { await download(`/api/admin/books/statement/${kind}/${payee.id}?from=${period.from}&to=${period.to}&format=csv`, 'statement.csv') } catch (downloadError) { setError(downloadError.message) } finally { setBusy(false) } }
  return <div className="bk-statement">
    <div className="bk-toolbar bk-noprint">
      <button type="button" className="bk-btn is-quiet" onClick={onBack}><ArrowLeft size={16} />Back</button>
      <span className="bk-spacer" />
      <button type="button" className="bk-btn" onClick={() => window.print()}><Printer size={16} />Print</button>
      <button type="button" className="bk-btn" onClick={csv} disabled={busy}><Download size={16} />{busy ? 'Preparing…' : 'Download CSV'}</button>
      <a className="bk-btn is-primary" href="/admin/finance">Pay in Money &amp; payouts</a>
    </div>
    {error && <p className="bk-alert" role="alert">{error}</p>}
    {!data && !error && <div className="bk-skeleton" role="status" aria-label="Loading the statement"><span /><span /></div>}
    {data && <article className="bk-card bk-doc">
      <header className="bk-doc-head">
        <div><small>DOORSTEP statement · {kind === 'rider' ? 'Rider' : 'Business'}</small><h2>{data.name}</h2><p>{dateText(`${data.period.from}T12:00:00Z`)} – {dateText(`${data.period.to}T12:00:00Z`)}</p></div>
        <dl className="bk-doc-totals">
          <div><dt>Opening balance</dt><dd>{money(data.openingMinor)}</dd></div>
          <div><dt>Earned ({data.totals.jobs} job{data.totals.jobs === 1 ? '' : 's'})</dt><dd>{money(data.totals.earnedMinor)}</dd></div>
          <div><dt>DOORSTEP fees</dt><dd>{money(-data.totals.feesMinor)}</dd></div>
          <div><dt>Paid out</dt><dd>{money(-(data.totals.paidOutMinor + data.totals.paidBySplitMinor))}</dd></div>
          <div className="is-total"><dt>Closing balance</dt><dd>{money(data.closingMinor)}</dd></div>
        </dl>
      </header>
      {data.lines.length ? <table className="bk-table bk-lines">
        <thead><tr><th scope="col">Date</th><th scope="col">Details</th><th scope="col">Amount</th><th scope="col">Balance</th></tr></thead>
        <tbody>
          <tr className="is-muted"><td>{dateText(`${data.period.from}T12:00:00Z`)}</td><td>Opening balance</td><td /><td>{money(data.openingMinor)}</td></tr>
          {data.lines.map((line, index) => <tr key={index} className={`is-${line.kind.toLowerCase()}`}>
            <td>{timeText(line.date)}</td>
            <td><b>{line.kind === 'JOB' ? `Job ${line.ref || ''}`.trim() : line.kind === 'PAYOUT' ? 'Payout' : line.kind === 'SPLIT' ? 'Paid at checkout' : line.description}</b>
              {line.kind === 'JOB' && <ul className="bk-parts">{line.parts.map((part, partIndex) => <li key={partIndex}><span>{part.label}</span><span>{money(part.amountMinor)}</span></li>)}</ul>}
              {line.kind !== 'JOB' && line.kind !== 'ENTRY' && <small>{line.description}{line.ref ? ` · ${line.ref}` : ''}</small>}
            </td>
            <td className={line.amountMinor < 0 ? 'is-out' : 'is-in'}>{money(line.amountMinor)}</td>
            <td>{money(line.balanceMinor)}</td>
          </tr>)}
        </tbody>
        <tfoot><tr><td /><th scope="row">Closing balance</th><td /><td>{money(data.closingMinor)}</td></tr></tfoot>
      </table> : <p className="bk-empty">No jobs or payouts in this period. Balance: {money(data.closingMinor)}.</p>}
      {data.awaitingPrice.length > 0 && <section className="bk-note"><b>Waiting for a price (not counted yet)</b><ul>{data.awaitingPrice.map((row, index) => <li key={index}>{dateText(row.date)} · {row.ref || ''} {row.description}</li>)}</ul></section>}
      <p className="bk-doc-foot">Owed right now: <b>{money(data.owedNowMinor)}</b>. Amounts in naira; times are Lagos time. Generated {timeText(new Date().toISOString())}.</p>
    </article>}
  </div>
}

export function Books() {
  const [period, setPeriod] = useState(() => presets()[0][2])
  const [tab, setTab] = useState('rider')
  const [open, setOpen] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const journal = async () => { setBusy(true); setError(''); try { await download(`/api/admin/books/journal.csv?from=${period.from}&to=${period.to}`, 'journal.csv') } catch (downloadError) { setError(downloadError.message) } finally { setBusy(false) } }
  return <div className="bk">
    <div className="bk-toolbar bk-noprint">
      <PeriodPicker period={period} onChange={setPeriod} />
    </div>
    {open ? <Statement kind={open.kind} payee={open.payee} period={period} onBack={() => setOpen(null)} /> : <>
      <Summary period={period} />
      <div className="bk-toolbar">
        <div className="bk-seg is-tabs" role="tablist" aria-label="Who">
          <button type="button" role="tab" aria-selected={tab === 'rider'} onClick={() => setTab('rider')}><Bike size={15} />Riders</button>
          <button type="button" role="tab" aria-selected={tab === 'business'} onClick={() => setTab('business')}><Building2 size={15} />Businesses</button>
        </div>
        <span className="bk-spacer" />
        <button type="button" className="bk-btn" onClick={journal} disabled={busy}><Download size={16} />{busy ? 'Preparing…' : 'Full journal (CSV)'}</button>
      </div>
      {error && <p className="bk-alert" role="alert">{error}</p>}
      <Payees key={tab} period={period} kind={tab} onOpen={(payee) => setOpen({ kind: tab, payee })} />
    </>}
  </div>
}
