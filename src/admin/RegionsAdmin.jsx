import { useState } from 'react'
import { AlertTriangle, Download, Upload } from 'lucide-react'
import { apiBase } from '../config/apiBase'

// Admin › Locations, regional tools: the CSV import with a check-first preview, and how far each LGA's directory
// has got across Delta, Edo and Rivers. Plain words throughout.

const token = () => { try { return localStorage.getItem('doorstep-admin-token') } catch { return null } }
async function call(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${apiBase}${path}`, { method, headers: { Authorization: `Bearer ${token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Something went wrong. Try again.')
  return data
}
async function save(path, fileName) {
  const response = await fetch(`${apiBase}${path}`, { headers: { Authorization: `Bearer ${token()}` } })
  if (!response.ok) throw new Error('Download failed.')
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url; link.download = fileName; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}
export const downloadTemplate = () => save('/api/admin/locations/import-template', 'doorstep-locations-template.csv')

/* --------------------------------- import --------------------------------- */
const ROW_TEXT = { ok: 'Ready', duplicate: 'Already there', error: 'Fix this' }
export function ImportPanel({ onImported }) {
  const [file, setFile] = useState(null)
  const [report, setReport] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [show, setShow] = useState('problems')
  const run = async (dryRun) => {
    if (!file) return
    setBusy(true); setError('')
    try {
      const result = await call('/api/admin/locations/import', { method: 'POST', body: { csv: file.text, fileName: file.name, dryRun } })
      setReport(result)
      if (!dryRun) { setFile(null); onImported?.() }
    } catch (importError) { setError(importError.message) } finally { setBusy(false) }
  }
  const pick = async (event) => {
    const chosen = event.target.files?.[0]
    setReport(null); setError('')
    if (!chosen) return
    if (chosen.size > 950_000) { setError('This file is over 1 MB. Split it into smaller files (about 5,000 rows each).'); return }
    if (/\.xlsx?$/i.test(chosen.name)) { setError('Excel file: open it in Excel, choose File › Save As › “CSV UTF-8”, then upload that file.'); return }
    setFile({ name: chosen.name, text: await chosen.text() })
  }
  const rows = (report?.rows || []).filter((row) => show === 'all' || row.status !== 'ok' || row.warnings.length)
  return <div className="ri">
    <ol className="ri-steps">
      <li>Download the template and fill one place per row: name, state, LGA, type, where the information came from (source), and the pin if you have it.</li>
      <li>Upload it. DOORSTEP checks every row first and shows what it will do — nothing is saved yet.</li>
      <li>Press Import. New places go to the review queue as “Pending” (or “Incomplete” without a pin). Nothing is ever imported as verified, and deliveries stay off.</li>
    </ol>
    <div className="ra-actions">
      <button type="button" className="la-ghost" onClick={() => downloadTemplate().catch((templateError) => setError(templateError.message))}><Download size={14} />Template (CSV)</button>
      <label className="la-ghost ri-file"><Upload size={14} />{file ? file.name : 'Choose CSV file'}<input type="file" accept=".csv,text/csv" onChange={pick} /></label>
      <button type="button" className="la-primary" disabled={!file || busy} onClick={() => run(true)}>{busy && !report ? 'Checking…' : 'Check file'}</button>
    </div>
    {error && <p className="la-error" role="alert">{error}</p>}
    {report?.headerProblems?.length > 0 && <ul className="la-flags">{report.headerProblems.map((problem) => <li key={problem}><AlertTriangle size={14} aria-hidden="true" />{problem}</li>)}</ul>}
    {report && !report.headerProblems?.length && <>
      <p className={report.dryRun ? 'la-muted' : 'la-ok'} role="status">{report.dryRun
        ? <>Checked {report.summary.total} rows: <b>{report.summary.ok} ready</b>, {report.summary.duplicates} already in the directory (skipped), {report.summary.errors} need fixing (skipped).</>
        : <>Imported {report.created} places. They’re in the review queue. {report.summary.duplicates + report.summary.errors} rows were skipped.</>}</p>
      {report.dryRun && report.summary.ok > 0 && <button type="button" className="la-primary" disabled={busy} onClick={() => run(false)}>{busy ? 'Importing…' : `Import ${report.summary.ok} place${report.summary.ok === 1 ? '' : 's'}`}</button>}
      <div className="la-chips"><button type="button" className={show === 'problems' ? 'is-on' : ''} onClick={() => setShow('problems')}>Problems & notes</button><button type="button" className={show === 'all' ? 'is-on' : ''} onClick={() => setShow('all')}>All rows</button></div>
      <div className="ri-table-wrap"><table className="ri-table">
        <thead><tr><th>Row</th><th>Place</th><th>Result</th><th>Details</th></tr></thead>
        <tbody>{rows.slice(0, 300).map((row) => <tr key={row.line} className={`is-${row.status}`}>
          <td>{row.line}</td><td>{row.label || '—'}</td><td>{ROW_TEXT[row.status]}</td>
          <td>{[...row.errors, row.duplicateOf ? `Same name as “${row.duplicateOf.name}”${row.duplicateOf.inFile ? ` (row ${row.duplicateOf.line})` : ''} in this LGA` : null, ...row.warnings].filter(Boolean).join(' · ')}</td>
        </tr>)}{rows.length === 0 && <tr><td colSpan={4}>Nothing to fix.</td></tr>}</tbody>
      </table></div>
      {rows.length > 300 && <p className="la-muted">Showing the first 300 of {rows.length} rows.</p>}
    </>}
  </div>
}

/* -------------------------------- coverage -------------------------------- */
export function CoverageTable({ coverage, onPick }) {
  const [state, setState] = useState(coverage?.[0]?.state || 'Delta')
  const current = coverage?.find((item) => item.state === state)
  if (!current) return null
  return <div className="rc">
    <div className="la-chips">{coverage.map((item) => <button type="button" key={item.state} className={item.state === state ? 'is-on' : ''} onClick={() => setState(item.state)}>{item.state} ({item.lgas.length})</button>)}</div>
    <div className="ri-table-wrap"><table className="ri-table">
      <thead><tr><th>LGA</th><th>Places</th><th>Verified</th><th>No pin yet</th></tr></thead>
      <tbody>{current.lgas.map((row) => <tr key={row.lga}><td><button type="button" className="rc-link" onClick={() => onPick(state, row.lga)}>{row.lga}</button></td><td>{row.total}</td><td>{row.verified}</td><td>{row.incomplete}</td></tr>)}</tbody>
    </table></div>
    <p className="la-muted">Counts include the LGA record itself once it’s added. Tap an LGA to see its places.</p>
  </div>
}
