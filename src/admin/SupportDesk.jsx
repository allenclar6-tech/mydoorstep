import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowUp, CheckCircle2, Headset, ImageIcon, Mail, Phone, RotateCcw, Search, Sparkles } from 'lucide-react'
import { apiBase } from '../config/apiBase'

const token = () => { try { return localStorage.getItem('doorstep-admin-token') } catch { return null } }
async function call(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${apiBase}${path}`, { method, headers: { Authorization: `Bearer ${token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || (response.status === 401 ? 'Your admin session expired. Sign in again.' : 'Something went wrong. Try again.'))
  return data
}
const ago = (value) => {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`
  return new Date(value).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })
}
const STATUS = { OPEN: ['Assistant', 'neutral'], WAITING_AGENT: ['Wants a person', 'warn'], WITH_AGENT: ['With agent', 'live'], RESOLVED: ['Resolved', 'done'] }
const VIEWS = [['needs_reply', 'Needs reply'], ['open', 'Open'], ['resolved', 'Resolved'], ['all', 'All']]
const QUICK_REPLIES = [
  'Hi, I’m looking into this for you now.',
  'Could you send your order number, please?',
  'Thanks for waiting. I’ve checked with the restaurant and ',
  'I’m sorry about this. We’ve started a refund review and will update you here.',
]

function AgentAttachment({ message }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!message.attachmentCount) return undefined
    let objectUrl = ''
    fetch(`${apiBase}/api/support/messages/${message.id}/attachments/0`, { headers: { Authorization: `Bearer ${token()}` } })
      .then((response) => response.ok ? response.blob() : null)
      .then((blob) => { if (blob) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl) } })
      .catch(() => undefined)
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [message.id, message.attachmentCount])
  if (!message.attachmentCount) return null
  return url ? <a href={url} target="_blank" rel="noopener noreferrer"><img className="hc-photo" src={url} alt="Photo from the customer" /></a> : <span className="hc-photo-placeholder"><ImageIcon size={16} aria-hidden="true" />Photo</span>
}

function Conversation({ ticketId, onBack, onChanged }) {
  const [ticket, setTicket] = useState(null)
  const [messages, setMessages] = useState([])
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [resolution, setResolution] = useState('')
  const [resolving, setResolving] = useState(false)
  const listRef = useRef(null)
  const latest = useRef(null)

  const load = useCallback(async (incremental = false) => {
    try {
      const after = incremental ? latest.current : null
      const data = await call(`/api/support/tickets/${ticketId}${after ? `?after=${encodeURIComponent(after)}` : ''}`)
      setTicket(data.ticket)
      setMessages((current) => {
        const next = incremental ? [...current, ...data.messages.filter((message) => !current.some((existing) => existing.id === message.id))] : data.messages
        latest.current = next.at(-1)?.createdAt || latest.current
        return next
      })
    } catch (loadError) { setError(loadError.message) }
  }, [ticketId])

  useEffect(() => { latest.current = null; setMessages([]); setTicket(null); load() }, [load])
  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) load(true) }, 5000)
    return () => window.clearInterval(timer)
  }, [load])
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }) }, [messages.length])

  const send = async (event) => {
    event?.preventDefault()
    if (!reply.trim()) return
    setBusy('send'); setError('')
    try {
      const data = await call(`/api/support/tickets/${ticketId}/messages`, { method: 'POST', body: { body: reply.trim() } })
      setMessages((current) => [...current, ...data.messages])
      latest.current = data.messages.at(-1)?.createdAt || latest.current
      setReply('')
      setTicket((current) => ({ ...current, status: 'WITH_AGENT' }))
      onChanged()
    } catch (sendError) { setError(sendError.message) } finally { setBusy('') }
  }
  const setStatus = async (status) => {
    setBusy(status); setError('')
    try {
      const data = await call(`/api/support/tickets/${ticketId}`, { method: 'PATCH', body: { status, resolution: status === 'RESOLVED' ? resolution.trim() || undefined : undefined } })
      setTicket((current) => ({ ...current, status: data.status }))
      setMessages((current) => [...current, ...data.messages])
      setResolving(false); setResolution('')
      onChanged()
    } catch (statusError) { setError(statusError.message) } finally { setBusy('') }
  }

  if (!ticket) return <div className="sd-convo sd-empty">{error || 'Loading conversation…'}</div>
  const [label, tone] = STATUS[ticket.status] || STATUS.OPEN
  return <div className="sd-convo">
    <header className="sd-convo-head">
      <button type="button" className="sd-back" aria-label="Back to conversations" onClick={onBack}><ArrowLeft size={20} /></button>
      <div className="sd-who">
        <strong>{ticket.customer?.name || 'Customer'}</strong>
        <span>{ticket.ticketNumber} · {ticket.category.replaceAll('_', ' ').toLowerCase()} · {ticket.customer?.role?.toLowerCase()}</span>
      </div>
      <span className={`sd-status is-${tone}`}>{label}</span>
    </header>
    <div className="sd-contact">
      {ticket.customer?.phone && <a href={`tel:${ticket.customer.phone}`}><Phone size={14} aria-hidden="true" />{ticket.customer.phone}</a>}
      {ticket.customer?.email && <a href={`mailto:${ticket.customer.email}`}><Mail size={14} aria-hidden="true" />{ticket.customer.email}</a>}
    </div>
    <ol className="hc-thread sd-thread" ref={listRef} aria-live="polite">
      {messages.map((message) => message.senderType === 'SYSTEM'
        ? <li key={message.id} className="hc-system">{message.body}</li>
        : <li key={message.id} className={`hc-msg ${message.senderType === 'ADMIN' ? 'is-mine' : message.senderType === 'AI' ? 'is-bot' : 'is-agent sd-customer'}`}>
          <span className="hc-who">{message.senderType === 'AI' ? <><Sparkles size={12} aria-hidden="true" />Assistant (automatic)</> : message.senderType === 'ADMIN' ? <><Headset size={12} aria-hidden="true" />{message.senderName}</> : ticket.customer?.name || 'Customer'}</span>
          <div className="hc-bubble"><AgentAttachment message={message} /><p>{message.body}</p></div>
          <span className="hc-meta">{new Date(message.createdAt).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
        </li>)}
    </ol>
    {error && <p className="hc-error" role="alert">{error}</p>}
    {ticket.status !== 'RESOLVED' && <div className="sd-quick">{QUICK_REPLIES.map((text) => <button type="button" key={text} onClick={() => setReply((current) => current ? `${current} ${text}` : text)}>{text.length > 34 ? `${text.slice(0, 32)}…` : text}</button>)}</div>}
    {resolving && <div className="sd-resolve">
      <label>What fixed it? (the customer sees this)<textarea rows="2" maxLength={1000} value={resolution} onChange={(event) => setResolution(event.target.value)} placeholder="e.g. Refund of ₦4,500 started; it can take 3–5 working days." /></label>
      <div><button type="button" className="row-more" onClick={() => setResolving(false)}>Cancel</button><button type="button" className="admin-primary" disabled={busy === 'RESOLVED'} onClick={() => setStatus('RESOLVED')}><CheckCircle2 size={15} /> Mark resolved</button></div>
    </div>}
    <form className="hc-composer sd-composer" onSubmit={send}>
      <div className="hc-field"><textarea rows="2" value={reply} maxLength={4000} aria-label="Reply" placeholder={ticket.status === 'RESOLVED' ? 'Reply to reopen this conversation…' : `Reply to ${ticket.customer?.name?.split(' ')[0] || 'the customer'}…`} onChange={(event) => setReply(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) send() }} /></div>
      <button type="submit" className="hc-send" aria-label="Send reply" disabled={busy === 'send' || !reply.trim()}><ArrowUp size={20} /></button>
    </form>
    <div className="sd-actions">
      {ticket.status === 'RESOLVED'
        ? <button type="button" className="row-more" disabled={Boolean(busy)} onClick={() => setStatus('WITH_AGENT')}><RotateCcw size={14} /> Reopen</button>
        : !resolving && <button type="button" className="row-more" onClick={() => setResolving(true)}><CheckCircle2 size={14} /> Resolve…</button>}
      <small>Replies reach the customer’s chat and notifications instantly. Ctrl/⌘ + Enter sends.</small>
    </div>
  </div>
}

/** Admin help desk: every conversation, who needs a reply, and the chat to answer it. */
export function SupportDesk() {
  const [view, setView] = useState('needs_reply')
  const [query, setQuery] = useState('')
  const [tickets, setTickets] = useState(null)
  const [needsReply, setNeedsReply] = useState(0)
  const [selected, setSelected] = useState(() => new URLSearchParams(window.location.search).get('ticket'))
  const [error, setError] = useState('')
  const load = useCallback(() => {
    const params = new URLSearchParams({ view, ...(query.trim() ? { q: query.trim() } : {}) })
    call(`/api/support/tickets?${params}`).then((data) => { setTickets(data.tickets); setNeedsReply(data.counts?.needsReply || 0); setError('') }).catch((loadError) => setError(loadError.message))
  }, [view, query])
  useEffect(() => { const timer = window.setTimeout(load, query ? 300 : 0); return () => window.clearTimeout(timer) }, [load, query])
  useEffect(() => { const timer = window.setInterval(() => { if (!document.hidden) load() }, 15000); return () => window.clearInterval(timer) }, [load])
  const open = (id) => { setSelected(id); window.history.replaceState({}, '', `/admin/support?ticket=${id}`) }
  const back = () => { setSelected(null); window.history.replaceState({}, '', '/admin/support') }

  return <section className={`sd${selected ? ' has-selection' : ''}`}>
    <aside className="sd-list">
      <div className="sd-list-head">
        <h2>Help desk {needsReply > 0 && <b>{needsReply}</b>}</h2>
        <label className="sd-search"><Search size={16} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, email, phone or reference" aria-label="Search conversations" /></label>
        <div className="sd-tabs" role="tablist">{VIEWS.map(([key, label]) => <button type="button" role="tab" key={key} aria-selected={view === key} className={view === key ? 'is-active' : ''} onClick={() => setView(key)}>{label}</button>)}</div>
      </div>
      {error && <p className="hc-error">{error}</p>}
      {tickets === null && !error && <p className="sd-empty">Loading…</p>}
      {tickets?.length === 0 && <p className="sd-empty">{view === 'needs_reply' ? 'All caught up. Nobody is waiting for a reply.' : 'No conversations here.'}</p>}
      <ul>{tickets?.map((ticket) => {
        const [label, tone] = STATUS[ticket.status] || STATUS.OPEN
        return <li key={ticket.id}><button type="button" className={`sd-row${selected === ticket.id ? ' is-selected' : ''}${ticket.needsReply ? ' needs-reply' : ''}`} onClick={() => open(ticket.id)}>
          <span className="sd-row-avatar" aria-hidden="true">{(ticket.customer?.name || '?').charAt(0)}</span>
          <span className="sd-row-main">
            <span className="sd-row-top"><strong>{ticket.customer?.name || 'Customer'}</strong><time>{ago(ticket.lastMessageAt)}</time></span>
            <span className="sd-row-preview">{ticket.lastMessage ? `${ticket.lastMessage.senderType === 'ADMIN' ? 'You: ' : ticket.lastMessage.senderType === 'AI' ? 'Assistant: ' : ''}${ticket.lastMessage.body}` : ticket.ticketNumber}</span>
            <span className="sd-row-tags"><span className={`sd-status is-${tone}`}>{label}</span><span>{ticket.category.replaceAll('_', ' ').toLowerCase()}</span></span>
          </span>
          {ticket.needsReply && <i className="sd-dot" aria-label="Needs reply" />}
        </button></li>
      })}</ul>
    </aside>
    <div className="sd-main">{selected ? <Conversation key={selected} ticketId={selected} onBack={back} onChanged={load} /> : <div className="sd-convo sd-empty"><Headset size={30} aria-hidden="true" /><p>Choose a conversation to reply.</p></div>}</div>
  </section>
}
