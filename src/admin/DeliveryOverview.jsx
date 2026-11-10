import { useEffect, useMemo, useState } from 'react'
import { apiBase } from '../config/apiBase'
import './deliveryOverview.css'

// Admin › Delivery overview: what's happening now, how deliveries went over a period (daily / weekly / monthly),
// delivery money (income, rider pay, margin) and how each rider performed.

const token = () => { try { return localStorage.getItem('doorstep-admin-token') } catch { return null } }
const money = (minor) => `${minor < 0 ? '−' : ''}₦${(Math.abs(Math.round(minor || 0)) / 100).toLocaleString('en-NG')}`
const day = (date) => new Date(date.getTime() + 3_600_000).toISOString().slice(0, 10)
const RANGES = [['today', 'Today', 0], ['week', 'Last 7 days', 6], ['month', 'Last 30 days', 29], ['quarter', 'Last 90 days', 89]]
const short = (key, weekly) => { const date = new Date(`${key}T12:00:00Z`); return weekly ? `w/c ${date.getUTCDate()} ${date.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}` : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) }

/** Simple bar chart: one or two series per bucket, labelled axis, values on hover/focus. */
function Bars({ series, keys, labels, format = String, weekly }) {
  const max = Math.max(1, ...series.flatMap((row) => keys.map((key) => Math.max(0, row[key]))))
  const width = Math.max(320, series.length * (keys.length * 10 + 10))
  const height = 160
  const band = width / series.length
  const bar = Math.min(18, (band - 6) / keys.length)
  const every = Math.ceil(series.length / 6)
  return <div className="ov-chart" role="img" aria-label={`${labels.join(' and ')} per ${weekly ? 'week' : 'day'}`}>
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <line x1="0" x2={width} y1={height} y2={height} className="ov-axis" />
      {series.map((row, index) => <g key={row.day}>
        {keys.map((key, k) => { const value = Math.max(0, row[key]); const h = value / max * (height - 8); return <rect key={key} className={`ov-bar is-${k}`} x={index * band + (band - bar * keys.length) / 2 + k * bar} y={height - h} width={Math.max(2, bar - 2)} height={h} rx="2"><title>{`${short(row.day, weekly)} · ${labels[k]}: ${format(row[key])}`}</title></rect> })}
      </g>)}
    </svg>
    <div className="ov-ticks" aria-hidden="true">{series.map((row, index) => index % every === 0 && <span key={row.day} style={{ left: `${(index + 0.5) / series.length * 100}%` }}>{short(row.day, weekly)}</span>)}</div>
    <p className="ov-legend">{labels.map((label, k) => <span key={label}><i className={`is-${k}`} />{label}</span>)} <small>Most: {format(max)}</small></p>
  </div>
}

export function DeliveryOverview() {
  const [range, setRange] = useState('week')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const period = useMemo(() => { const back = RANGES.find(([key]) => key === range)[2]; const now = new Date(); return { from: day(new Date(now.getTime() - back * 86_400_000)), to: day(now) } }, [range])
  useEffect(() => {
    setData(null); setError('')
    fetch(`${apiBase}/api/admin/delivery-overview?from=${period.from}&to=${period.to}`, { headers: { Authorization: `Bearer ${token()}` } })
      .then(async (response) => { const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.message || (response.status === 403 ? 'Your role can’t see the delivery overview.' : 'The overview couldn’t be loaded.')); setData(body) })
      .catch((loadError) => setError(loadError instanceof TypeError ? 'We can’t reach DOORSTEP. Check your internet.' : loadError.message))
  }, [period.from, period.to])
  const weekly = data?.bucketDays === 7

  return <div className="ov">
    <div className="ov-seg" role="group" aria-label="Period">{RANGES.map(([key, label]) => <button key={key} type="button" aria-pressed={range === key} onClick={() => setRange(key)}>{label}</button>)}</div>
    {error && <p className="ov-alert" role="alert">{error}</p>}
    {!data && !error && <div className="ov-skeleton" role="status" aria-label="Loading"><span /><span /><span /><span /></div>}
    {data && <>
      <section aria-label="Right now">
        <h3 className="ov-h">Right now</h3>
        <div className="ov-kpis">
          <a href="/admin/deliveries"><span>On the way</span><b>{data.now.active}</b></a>
          <a href="/admin/deliveries" className={data.now.unassigned ? 'is-alert' : ''}><span>Waiting for a rider</span><b>{data.now.unassigned}</b></a>
          <a href="/admin/delivery-quotes" className={data.now.quotesToPrice ? 'is-warn' : ''}><span>Prices to set</span><b>{data.now.quotesToPrice}</b></a>
          <a href="/admin/delivery-quotes"><span>Waiting for customers</span><b>{data.now.quotesWithCustomer}</b></a>
          <a href="/admin/road-reports" className={data.now.awaitingRouteCheck ? 'is-warn' : ''}><span>Route checks</span><b>{data.now.awaitingRouteCheck}</b></a>
        </div>
      </section>

      <section aria-label="This period">
        <h3 className="ov-h">{RANGES.find(([key]) => key === range)[1]}</h3>
        <div className="ov-kpis">
          <div><span>Delivered</span><b>{data.totals.delivered}</b></div>
          <div className={data.totals.failed ? 'is-alert' : ''}><span>Failed</span><b>{data.totals.failed}</b></div>
          <div><span>Prices accepted</span><b>{data.quotesAccepted}</b></div>
          <div><span>Average delivery fee</span><b>{money(data.totals.averageFeeMinor)}</b></div>
          <div><span>Delivery income</span><b>{money(data.totals.incomeMinor)}</b></div>
          <div><span>Rider pay</span><b>{money(data.totals.riderPayMinor)}</b></div>
          <div className={data.totals.marginMinor < 0 ? 'is-alert' : 'is-good'}><span>Delivery margin</span><b>{money(data.totals.marginMinor)}</b></div>
        </div>
      </section>

      {data.series.length > 1 && <div className="ov-grid">
        <section className="ov-card"><h3>Deliveries</h3><Bars series={data.series} keys={['delivered', 'failed']} labels={['Delivered', 'Failed']} weekly={weekly} /></section>
        <section className="ov-card"><h3>Delivery money</h3><Bars series={data.series} keys={['incomeMinor', 'riderPayMinor']} labels={['Delivery income', 'Rider pay']} format={money} weekly={weekly} /></section>
      </div>}

      <section className="ov-card">
        <h3>Rider performance</h3>
        {data.riders.length ? <table className="ov-table">
          <thead><tr><th scope="col">Rider</th><th scope="col">Delivered</th><th scope="col">Failed</th><th scope="col">Accepts jobs</th><th scope="col">Avg time</th><th scope="col">Rating</th><th scope="col">Earned</th></tr></thead>
          <tbody>{data.riders.map((rider) => <tr key={rider.riderId}>
            <th scope="row"><b>{rider.name}</b><small>{rider.vehicle || 'Rider'}{rider.online ? ' · online' : ''}</small></th>
            <td data-label="Delivered">{rider.delivered}</td>
            <td data-label="Failed" className={rider.failed ? 'is-alert' : ''}>{rider.failed}</td>
            <td data-label="Accepts jobs" className={rider.acceptanceRate != null && rider.acceptanceRate < 60 ? 'is-alert' : ''}>{rider.acceptanceRate == null ? '—' : `${rider.acceptanceRate}%`}<small>{rider.accepted}/{rider.accepted + rider.declined + rider.expired} offers</small></td>
            <td data-label="Avg time">{rider.averageMinutes == null ? '—' : `${rider.averageMinutes} min`}</td>
            <td data-label="Rating">{rider.rating == null ? '—' : `★ ${rider.rating.toFixed(1)}`}</td>
            <td data-label="Earned">{money(rider.earnedMinor)}</td>
          </tr>)}</tbody>
        </table> : <p className="ov-muted">No rider activity in this period.</p>}
        <p className="ov-muted">“Accepts jobs” counts offers the rider accepted out of those they accepted, declined or let run out. “Avg time” is from accepting the job to delivery.</p>
      </section>
    </>}
  </div>
}
