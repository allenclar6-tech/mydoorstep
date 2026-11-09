import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, ChevronRight, MapPin, RefreshCw, Search } from 'lucide-react'
import { apiBase } from '../config/apiBase'
import '../chat/orderChat.css'

// Admin › Order chats: read-only view of customer ↔ rider and store ↔ rider chats, for disputes and reports.
// Admins can't post here (support talks to people through Help messages).

const token = () => { try { return localStorage.getItem('doorstep-admin-token') } catch { return null } }
async function call(path) {
  const response = await fetch(`${apiBase}${path}`, { headers: { Authorization: `Bearer ${token()}` } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(response.status === 404 ? 'No order with that number.' : response.status === 401 ? 'You’ve been signed out. Sign in again.' : 'Couldn’t load chats. Try again.'), { status: response.status })
  return body
}
const CHANNEL_TEXT = { CUSTOMER_RIDER: 'Customer ↔ rider', STORE_RIDER: 'Store ↔ rider' }
const FROM_TEXT = { CUSTOMER: 'Customer', RIDER: 'Rider', STORE: 'Store' }
const when = (value) => new Date(value).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

function Thread({ orderNumber, onBack }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { call(`/api/admin/chats?order=${encodeURIComponent(orderNumber)}`).then(setData).catch((loadError) => setError(loadError.message)) }, [orderNumber])
  return <div className="oc-admin">
    <button type="button" className="dq-link" onClick={onBack}><ArrowLeft size={15} />All chats</button>
    {error && <p className="dq-msg is-error">{error}</p>}
    {!data && !error && <p className="dq-muted">Loading…</p>}
    {data && <>
      <h2>{data.orderNumber}</h2>
      <p className="dq-muted">Customer: {data.customer || '—'} · Rider: {data.rider || '—'} · Store: {data.store || '—'}</p>
      {['CUSTOMER_RIDER', 'STORE_RIDER'].map((channel) => {
        const messages = data.messages.filter((message) => message.channel === channel)
        return <section key={channel} className="oc-admin-thread" aria-label={CHANNEL_TEXT[channel]}>
          <h3>{CHANNEL_TEXT[channel]}</h3>
          {!messages.length && <p className="dq-muted">No messages.</p>}
          {messages.map((message) => <div key={message.id} className={`oc-msg ${message.from === 'RIDER' ? 'is-mine' : 'is-theirs'}${message.reportedAt ? ' oc-reported' : ''}`}>
            <span className="oc-from">{FROM_TEXT[message.from] || message.from}</span>
            <div className="oc-bubble">{message.location ? <a className="oc-location" href={`https://www.google.com/maps/search/?api=1&query=${message.location.latitude},${message.location.longitude}`} target="_blank" rel="noreferrer"><MapPin size={16} aria-hidden="true" /><span><b>{message.body}</b><small>Open in Maps</small></span></a> : message.body}</div>
            <small className="oc-meta">{when(message.createdAt)}{message.hidden ? ' · details hidden' : ''}{message.readAt ? ' · read' : ''}</small>
            {message.reportedAt && <small className="oc-flag">Reported: {message.reportReason}</small>}
          </div>)}
        </section>
      })}
    </>}
  </div>
}

export function OrderChats() {
  const [reported, setReported] = useState(false)
  const [query, setQuery] = useState('')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(() => { try { return new URLSearchParams(window.location.search).get('order') } catch { return null } })
  const load = useCallback(() => { setError(''); call(`/api/admin/chats${reported ? '?reported=1' : ''}`).then(setData).catch((loadError) => setError(loadError.message)) }, [reported])
  useEffect(() => { load() }, [load])
  if (selected) return <div className="ph-page dq-page"><Thread orderNumber={selected} onBack={() => { setSelected(null); load() }} /></div>
  return <div className="ph-page dq-page oc-admin">
    <p className="dq-muted">Read-only. Chats between customers, riders and stores, kept for review. Reported messages are marked in red.</p>
    <div className="dq-tabs" role="tablist">{[[false, 'Recent'], [true, 'Reported']].map(([value, label]) => <button key={label} type="button" role="tab" aria-selected={reported === value} className={reported === value ? 'is-on' : ''} onClick={() => setReported(value)}>{label}</button>)}</div>
    <form className="dq-search" onSubmit={(event) => { event.preventDefault(); if (query.trim()) setSelected(query.trim()) }}><Search size={16} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Order number" aria-label="Find an order’s chat" /><button type="submit">Open</button></form>
    {error && <p className="dq-msg is-error">{error} <button type="button" className="dq-link" onClick={load}><RefreshCw size={13} />Try again</button></p>}
    {!data && !error && <p className="dq-muted">Loading…</p>}
    {data && (data.chats.length ? <ul className="oc-admin-list">{data.chats.map((chat) => <li key={`${chat.orderNumber}:${chat.channel}`}><button type="button" onClick={() => setSelected(chat.orderNumber)}>
      <span><b>{chat.orderNumber} · {CHANNEL_TEXT[chat.channel]}</b><small>{chat.last}</small><small>{when(chat.at)}</small></span>
      {chat.reported && <span className="oc-flag">Reported</span>}
      <ChevronRight size={18} aria-hidden="true" />
    </button></li>)}</ul> : <p className="dq-muted">{reported ? 'No reported messages.' : 'No chats yet.'}</p>)}
  </div>
}
