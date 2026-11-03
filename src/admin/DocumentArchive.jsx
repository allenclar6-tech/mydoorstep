import { useEffect, useState } from 'react'
import { Bike, ChefHat, Download, Eye, FileText, Image, Search, Store } from 'lucide-react'
import { apiBase } from '../config/apiBase'
import './documentArchive.css'

// Admin › Documents: every ID, business certificate and vehicle paper partners and riders have uploaded,
// kept after approval or rejection so it can be found again. Downloads are recorded in the activity log.

const adminToken = () => { try { return localStorage.getItem('doorstep-admin-token') } catch { return null } }
const KINDS = [['all', 'All'], ['restaurant', 'Restaurants'], ['grocery', 'Shops'], ['rider', 'Riders']]
const KIND_ICON = { restaurant: ChefHat, grocery: Store, rider: Bike }
const STATUS_TEXT = { PENDING_APPROVAL: 'Waiting for review', NEEDS_INFORMATION: 'Asked for more info', APPROVED: 'Approved', REJECTED: 'Rejected', SUSPENDED: 'Suspended' }
const day = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const size = (bytes) => bytes == null ? '' : bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

export function DocumentArchive() {
  const [kind, setKind] = useState('all')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [state, setState] = useState({ loading: true, documents: [], totals: null, error: '' })
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => { const timer = window.setTimeout(() => setQuery(search.trim()), 350); return () => window.clearTimeout(timer) }, [search])
  useEffect(() => {
    const controller = new AbortController()
    setState((current) => ({ ...current, loading: true, error: '' }))
    const params = new URLSearchParams({ kind, ...(query ? { search: query } : {}) })
    fetch(`${apiBase}/api/admin/documents?${params}`, { headers: { Authorization: `Bearer ${adminToken()}` }, signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (response.status === 401) throw new Error('You’ve been signed out. Sign in again.')
        if (!response.ok || !Array.isArray(body.documents)) throw new Error('The documents couldn’t load. Try again in a minute.')
        setState({ loading: false, documents: body.documents, totals: body.totals, error: '' })
      })
      .catch((error) => { if (error.name !== 'AbortError') setState({ loading: false, documents: [], totals: null, error: error instanceof TypeError ? 'We can’t reach DOORSTEP. Check your internet.' : error.message }) })
    return () => controller.abort()
  }, [kind, query])

  const open = async (doc, view) => {
    setBusy(`${doc.id}:${view ? 'view' : 'save'}`); setNote('')
    // Open the tab first so phone browsers don't block it as a pop-up.
    const tab = view ? window.open('', '_blank') : null
    try {
      const response = await fetch(`${apiBase}/api/admin/documents/${doc.source}/${doc.id}/file${view ? '?view=1' : ''}`, { headers: { Authorization: `Bearer ${adminToken()}` } })
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error === 'DOCUMENT_FILE_MISSING' ? 'This file is no longer on the server.' : 'The file couldn’t be opened. Try again.') }
      const url = URL.createObjectURL(await response.blob())
      if (tab) tab.location.href = url
      else { const link = document.createElement('a'); link.href = url; link.download = doc.fileName; document.body.appendChild(link); link.click(); link.remove() }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (error) { tab?.close(); setNote(error instanceof TypeError ? 'We can’t reach DOORSTEP. Check your internet.' : error.message) } finally { setBusy('') }
  }

  const { loading, documents, totals, error } = state
  return <section className="da-page">
    <header className="da-head">
      <div><span className="section-kicker">RECORDS</span><h2>Partner & rider documents</h2><p>Every ID, business certificate and vehicle paper uploaded by restaurants, shops and riders. They stay here after approval or rejection. Each download is written to the activity log.</p></div>
      {totals && <dl className="da-totals"><div><dt>All files</dt><dd>{totals.all}</dd></div><div><dt>Businesses</dt><dd>{totals.business}</dd></div><div><dt>Riders</dt><dd>{totals.rider}</dd></div></dl>}
    </header>
    <div className="da-tools">
      <div className="da-chips" role="tablist" aria-label="Who uploaded">{KINDS.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={kind === key} className={kind === key ? 'is-on' : ''} onClick={() => setKind(key)}>{label}</button>)}</div>
      <label className="da-search"><Search size={16} aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, business, email or phone" aria-label="Search documents" /></label>
    </div>
    {note && <p className="da-note is-error" role="alert">{note}</p>}
    {error ? <p className="da-note is-error" role="alert">{error}</p>
      : loading && !documents.length ? <p className="da-note" role="status">Loading documents…</p>
        : !documents.length ? <div className="da-empty"><FileText size={28} aria-hidden="true" /><b>{query ? 'No documents match' : 'No documents yet'}</b><span>{query ? `Nothing found for “${query}”.` : 'Documents appear here as soon as a partner or rider uploads one.'}</span></div>
          : <ul className="da-list">{documents.map((doc) => {
            const Icon = KIND_ICON[doc.kind] || FileText
            return <li key={`${doc.source}:${doc.id}`} className={`da-row${doc.stored ? '' : ' is-missing'}`}>
              <span className={`da-icon is-${doc.kind}`} aria-hidden="true"><Icon size={18} /></span>
              <span className="da-main">
                <b>{doc.owner}</b>
                <small>{doc.typeLabel} · {doc.fileType === 'PDF' ? <FileText size={12} aria-hidden="true" /> : <Image size={12} aria-hidden="true" />} {doc.fileType}{doc.sizeBytes != null ? ` · ${size(doc.sizeBytes)}` : ''} · uploaded {day(doc.uploadedAt)}</small>
                <small>{[doc.contact && doc.contact !== doc.owner ? doc.contact : '', doc.phone, doc.email].filter(Boolean).join(' · ')}</small>
                <span className="da-tags">{doc.status && <em className={`da-tag is-${String(doc.status).toLowerCase()}`}>{STATUS_TEXT[doc.status] || doc.status}</em>}{doc.verifiedAt && <em className="da-tag is-approved">Checked {day(doc.verifiedAt)}</em>}{!doc.stored && <em className="da-tag is-rejected">File missing on server</em>}</span>
              </span>
              <span className="da-actions">
                <button type="button" disabled={!doc.stored || Boolean(busy)} onClick={() => open(doc, true)} aria-label={`View ${doc.typeLabel} for ${doc.owner}`}><Eye size={16} />{busy === `${doc.id}:view` ? 'Opening…' : 'View'}</button>
                <button type="button" className="is-main" disabled={!doc.stored || Boolean(busy)} onClick={() => open(doc, false)} aria-label={`Download ${doc.typeLabel} for ${doc.owner}`}><Download size={16} />{busy === `${doc.id}:save` ? 'Saving…' : 'Download'}</button>
              </span>
            </li>
          })}</ul>}
  </section>
}
