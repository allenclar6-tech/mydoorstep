import { useEffect, useState } from 'react'
import { Download, FileText } from 'lucide-react'
import { apiBase } from '../config/apiBase'
import '../admin/books.css'

// Riders and businesses: their own statement for a month (opening balance, jobs, fees, payouts, closing
// balance) with a CSV download — the same figures DOORSTEP's admins see.

const readToken = () => { try { return localStorage.getItem('doorstep-token') } catch { return null } }
const money = (minor) => `${minor < 0 ? '−' : ''}₦${(Math.abs(Math.round(minor || 0)) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
function months() {
  const now = new Date(Date.now() + 3_600_000)
  const list = []
  for (let back = 0; back < 6; back += 1) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))
    const end = back === 0 ? now : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back + 1, 0))
    list.push({ key: start.toISOString().slice(0, 7), label: start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }), from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) })
  }
  return list
}

export function MyStatement() {
  const options = months()
  const [month, setMonth] = useState(options[0])
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setData(null); setError('')
    fetch(`${apiBase}/api/finance/statement?from=${month.from}&to=${month.to}`, { headers: { Authorization: `Bearer ${readToken()}` } })
      .then(async (response) => { const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.message || 'Your statement couldn’t be loaded.'); setData(body) })
      .catch((loadError) => setError(loadError instanceof TypeError ? 'No internet. Try again when you’re back online.' : loadError.message))
  }, [month.key])
  const download = async () => {
    setBusy(true)
    try {
      const response = await fetch(`${apiBase}/api/finance/statement?from=${month.from}&to=${month.to}&format=csv`, { headers: { Authorization: `Bearer ${readToken()}` } })
      if (!response.ok) throw new Error('The download didn’t work. Try again.')
      const url = URL.createObjectURL(await response.blob())
      const link = Object.assign(document.createElement('a'), { href: url, download: `DOORSTEP-statement-${month.key}.csv` })
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (downloadError) { setError(downloadError.message) } finally { setBusy(false) }
  }
  return <>{data?.kind === 'RESTAURANT' && <MyDeliveryDeal />}<section className="wl-card bk-mine" aria-labelledby="bk-mine-title">
    <header className="bk-card-head">
      <h3 id="bk-mine-title"><FileText size={17} aria-hidden="true" /> Monthly statement</h3>
      <label className="bk-dates"><span className="bk-sr">Month</span><select value={month.key} onChange={(event) => setMonth(options.find((option) => option.key === event.target.value))}>{options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
    </header>
    {error && <p className="bk-alert" role="alert">{error}</p>}
    {!data && !error && <p className="bk-muted" role="status">Loading…</p>}
    {data && <>
      <dl className="bk-doc-totals">
        <div><dt>Opening balance</dt><dd>{money(data.openingMinor)}</dd></div>
        <div><dt>Earned ({data.totals.jobs} job{data.totals.jobs === 1 ? '' : 's'})</dt><dd>{money(data.totals.earnedMinor)}</dd></div>
        <div><dt>DOORSTEP fees</dt><dd>{money(-data.totals.feesMinor)}</dd></div>
        <div><dt>Paid to you</dt><dd>{money(-(data.totals.paidOutMinor + data.totals.paidBySplitMinor))}</dd></div>
        <div className="is-total"><dt>Closing balance</dt><dd>{money(data.closingMinor)}</dd></div>
      </dl>
      <button type="button" className="bk-btn" onClick={download} disabled={busy}><Download size={16} />{busy ? 'Preparing…' : 'Download statement (CSV)'}</button>
    </>}
  </section></>
}

/** Businesses: the delivery deal DOORSTEP set for them (read-only). */
function MyDeliveryDeal() {
  const [deal, setDeal] = useState(null)
  useEffect(() => { fetch(`${apiBase}/api/restaurant/delivery-deal`, { headers: { Authorization: `Bearer ${readToken()}` } }).then((response) => response.ok ? response.json() : null).then((body) => setDeal(body?.deal || null)).catch(() => setDeal(null)) }, [])
  if (!deal) return null
  return <section className="wl-card bk-mine" aria-label="Your delivery deal">
    <h3>Your delivery deal</h3>
    <p className="bk-muted">{deal.text}{deal.mode !== 'STANDARD' && !deal.active ? ' (not active right now)' : ''}{deal.endsAt ? ` · until ${new Date(deal.endsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}</p>
    {deal.mode !== 'STANDARD' && <p className="bk-muted">Your part of each delivery is taken from your share of that order and listed on your statement. To change the deal, contact DOORSTEP.</p>}
  </section>
}
