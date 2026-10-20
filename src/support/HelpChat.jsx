import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowUp, Camera, Headset, ImageIcon, MessageCircle, Sparkles, X } from 'lucide-react'
import { apiBase } from '../config/apiBase'

const POLL_OPEN_MS = 5000
const POLL_CLOSED_MS = 30000
const readToken = () => { try { return localStorage.getItem('doorstep-token') } catch { return null } }
const timeOf = (value) => new Date(value).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' })
const QUICK_TOPICS = [
  ['Where’s my order?', 'LATE_DELIVERY', 'Where is my order?'],
  ['Payment problem', 'PAYMENT', 'I have a problem with a payment.'],
  ['Wrong or missing item', 'WRONG_FOOD', 'Something in my order was wrong or missing.'],
  ['Account help', 'ACCOUNT', 'I need help with my account.'],
]
const STATUS_LINE = {
  OPEN: 'Assistant · a person can join any time',
  WAITING_AGENT: 'Waiting for a DOORSTEP agent…',
  WITH_AGENT: 'You’re chatting with the DOORSTEP team',
  RESOLVED: 'Resolved · reply to reopen',
}

async function call(path, { method = 'GET', body } = {}) {
  const token = readToken()
  const response = await fetch(`${apiBase}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(data.message || (response.status === 429 ? 'You’re sending messages very quickly. Wait a moment.' : 'We couldn’t send that. Check your connection and try again.')), { status: response.status })
  return data
}

/**
 * One help conversation. Signed-in people get a stored ticket that DOORSTEP agents answer from the admin
 * Support desk; guests get the assistant only. New agent replies arrive by polling while open.
 */
export function useHelpConversation({ open }) {
  const signedIn = Boolean(readToken())
  const [ticket, setTicket] = useState(null)
  const [messages, setMessages] = useState([])
  const [loaded, setLoaded] = useState(!signedIn)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [unread, setUnread] = useState(0)
  const lastSeen = useRef(null)

  const merge = useCallback((incoming) => {
    if (!incoming?.length) return
    setMessages((current) => {
      const known = new Set(current.map((message) => message.id).filter(Boolean))
      const fresh = incoming.filter((message) => !message.id || !known.has(message.id))
      return fresh.length ? [...current.filter((message) => !message.pending), ...fresh] : current
    })
  }, [])

  // Load the open conversation once.
  useEffect(() => {
    if (!signedIn) return
    call('/api/support/tickets/active').then((data) => { setTicket(data.ticket); setMessages(data.messages || []); setLoaded(true) }).catch(() => setLoaded(true))
  }, [signedIn])

  // Poll for new messages: often while the chat is open, rarely while it is closed (for the unread dot).
  useEffect(() => {
    if (!signedIn || !ticket) return undefined
    let stopped = false
    const tick = async () => {
      if (document.hidden) return
      try {
        const after = messages.filter((message) => message.id && message.createdAt).at(-1)?.createdAt
        const data = await call(`/api/support/tickets/${ticket.id}${after ? `?after=${encodeURIComponent(after)}` : ''}`)
        if (stopped) return
        setTicket(data.ticket)
        if (data.messages?.length) {
          merge(data.messages)
          if (!open) setUnread((count) => count + data.messages.filter((message) => message.senderType === 'ADMIN').length)
        }
      } catch { /* network blips: try again next tick */ }
    }
    const timer = window.setInterval(tick, open ? POLL_OPEN_MS : POLL_CLOSED_MS)
    const onVisible = () => { if (!document.hidden) tick() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { stopped = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [signedIn, ticket?.id, open, messages, merge])

  useEffect(() => { if (open) { setUnread(0); lastSeen.current = Date.now() } }, [open])

  const send = useCallback(async ({ text, photo, category = 'GENERAL' }) => {
    const body = text.trim() || (photo ? 'Photo attached' : '')
    if (!body || sending) return false
    setSending(true); setError('')
    const localId = `local-${Date.now()}`
    setMessages((current) => [...current, { id: localId, pending: true, senderType: 'CUSTOMER', body, preview: photo ? URL.createObjectURL(photo) : null, createdAt: new Date().toISOString() }])
    try {
      if (!signedIn) {
        const data = await call('/api/support/ai', { method: 'POST', body: { message: body, category } })
        setMessages((current) => [...current.map((message) => message.id === localId ? { ...message, pending: false } : message), { id: `ai-${Date.now()}`, senderType: 'AI', body: data.reply, createdAt: new Date().toISOString() }])
        return true
      }
      let attachments = []
      if (photo) {
        const upload = new FormData(); upload.append('document', photo)
        const response = await fetch(`${apiBase}/api/uploads/private-document`, { method: 'POST', headers: { Authorization: `Bearer ${readToken()}` }, body: upload })
        const uploaded = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(uploaded.message || 'The photo could not be uploaded. Use a JPEG or PNG under 5 MB.')
        attachments = [uploaded.storageKey]
      }
      const data = ticket && ticket.status !== undefined
        ? await call(`/api/support/tickets/${ticket.id}/messages`, { method: 'POST', body: { body, attachments } })
        : await call('/api/support/tickets', { method: 'POST', body: { message: body, category, attachments } })
      if (data.ticket) setTicket(data.ticket)
      else if (ticket?.status === 'RESOLVED') setTicket({ ...ticket, status: 'OPEN' })
      setMessages((current) => [...current.filter((message) => message.id !== localId), ...(data.messages || []).map((message, index) => index === 0 && photo ? { ...message, preview: URL.createObjectURL(photo) } : message)])
      return true
    } catch (sendError) {
      setMessages((current) => current.map((message) => message.id === localId ? { ...message, pending: false, failed: true } : message))
      setError(sendError.message)
      return false
    } finally { setSending(false) }
  }, [signedIn, ticket, sending])

  const askForPerson = useCallback(async () => {
    if (!ticket) return
    try {
      const data = await call(`/api/support/tickets/${ticket.id}/handoff`, { method: 'POST' })
      setTicket((current) => ({ ...current, status: data.status }))
      merge(data.messages)
    } catch (handoffError) { setError(handoffError.message) }
  }, [ticket, merge])

  return { signedIn, ticket, messages, loaded, sending, error, unread, send, askForPerson, clearError: () => setError('') }
}

function Attachment({ message }) {
  const [url, setUrl] = useState(message.preview || '')
  useEffect(() => {
    if (url || !message.id || message.id.startsWith('local-') || !message.attachmentCount) return undefined
    let revoked = ''
    fetch(`${apiBase}/api/support/messages/${message.id}/attachments/0`, { headers: { Authorization: `Bearer ${readToken()}` } })
      .then((response) => response.ok ? response.blob() : null)
      .then((blob) => { if (blob) { revoked = URL.createObjectURL(blob); setUrl(revoked) } })
      .catch(() => undefined)
    return () => { if (revoked) URL.revokeObjectURL(revoked) }
  }, [message.id])
  if (!message.preview && !message.attachmentCount) return null
  return url ? <img className="hc-photo" src={url} alt="Photo sent in the chat" /> : <span className="hc-photo-placeholder"><ImageIcon size={16} aria-hidden="true" />Photo</span>
}

function Bubble({ message }) {
  if (message.senderType === 'SYSTEM') return <li className="hc-system">{message.body}</li>
  const mine = message.senderType === 'CUSTOMER'
  const who = message.senderType === 'ADMIN' ? `${message.senderName || 'DOORSTEP'} · DOORSTEP team` : message.senderType === 'AI' ? 'DOORSTEP assistant' : null
  return <li className={`hc-msg ${mine ? 'is-mine' : message.senderType === 'ADMIN' ? 'is-agent' : 'is-bot'}${message.failed ? ' is-failed' : ''}`}>
    {who && <span className="hc-who">{message.senderType === 'AI' ? <Sparkles size={12} aria-hidden="true" /> : <Headset size={12} aria-hidden="true" />}{who}</span>}
    <div className="hc-bubble"><Attachment message={message} />{message.body !== 'Photo attached' && <p>{message.body}</p>}</div>
    <span className="hc-meta">{message.pending ? 'Sending…' : message.failed ? 'Not sent' : message.createdAt ? timeOf(message.createdAt) : ''}</span>
  </li>
}

/** The conversation UI (thread + composer). Used in the floating widget and on the Support page. */
export function HelpConversation({ conversation, onClose, fullPage = false }) {
  const { signedIn, ticket, messages, loaded, sending, error, send, askForPerson, clearError } = conversation
  const [text, setText] = useState('')
  const [photo, setPhoto] = useState(null)
  const [category, setCategory] = useState('GENERAL')
  const listRef = useRef(null)
  const inputRef = useRef(null)
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }) }, [messages.length])
  useEffect(() => {
    const field = inputRef.current
    if (!field) return
    field.style.height = 'auto'
    field.style.height = `${Math.min(field.scrollHeight, 120)}px`
  }, [text])

  const submit = async (event) => {
    event?.preventDefault()
    const sent = await send({ text, photo, category })
    if (sent) { setText(''); setPhoto(null) }
  }
  const status = ticket?.status
  const canAskPerson = signedIn && ticket && status === 'OPEN'
  return <div className={`hc-convo${fullPage ? ' is-page' : ''}`}>
    <header className="hc-head">
      {onClose && <button type="button" className="hc-icon hc-back" aria-label="Close help chat" onClick={onClose}><ArrowLeft size={20} /></button>}
      <span className="hc-avatar" aria-hidden="true"><MessageCircle size={20} /></span>
      <div className="hc-head-text">
        <strong>DOORSTEP Help</strong>
        <span><i className={status === 'WITH_AGENT' ? 'is-live' : ''} aria-hidden="true" />{status ? STATUS_LINE[status] : signedIn ? 'Ask us anything about your order' : 'Assistant · sign in to chat with our team'}</span>
      </div>
      {onClose && <button type="button" className="hc-icon hc-close" aria-label="Close help chat" onClick={onClose}><X size={20} /></button>}
    </header>

    <ol className="hc-thread" ref={listRef} aria-live="polite" aria-label="Conversation">
      {loaded && messages.length === 0 && <li className="hc-intro">
        <span className="hc-intro-icon" aria-hidden="true"><Sparkles size={22} /></span>
        <strong>Hi{signedIn ? '' : ' there'}! How can we help?</strong>
        <p>Pick a topic or type below. The assistant answers straight away{signedIn ? ', and a person from the DOORSTEP team can join this chat.' : '. Sign in if you need a person to follow up.'}</p>
        <div className="hc-chips">{QUICK_TOPICS.map(([label, topic, prompt]) => <button type="button" key={label} disabled={sending} onClick={() => { setCategory(topic); send({ text: prompt, category: topic }) }}>{label}</button>)}</div>
      </li>}
      {!loaded && <li className="hc-system">Loading your conversation…</li>}
      {messages.map((message) => <Bubble key={message.id} message={message} />)}
      {sending && <li className="hc-typing" aria-label="Sending"><span /><span /><span /></li>}
    </ol>

    {ticket?.ticketNumber && <p className="hc-ref">Reference {ticket.ticketNumber}</p>}
    {canAskPerson && <button type="button" className="hc-person" onClick={askForPerson}><Headset size={16} aria-hidden="true" />Talk to a person</button>}
    {error && <p className="hc-error" role="alert" onClick={clearError}>{error}</p>}

    <form className="hc-composer" onSubmit={submit}>
      {signedIn && <label className="hc-icon hc-attach" title="Attach a photo">
        <Camera size={20} aria-hidden="true" /><span className="sr-only">Attach a photo</span>
        <input type="file" accept="image/jpeg,image/png" onChange={(event) => { setPhoto(event.target.files?.[0] || null); event.target.value = '' }} />
      </label>}
      <div className="hc-field">
        {photo && <span className="hc-chip-photo"><ImageIcon size={14} aria-hidden="true" />{photo.name.slice(0, 24)}<button type="button" aria-label="Remove photo" onClick={() => setPhoto(null)}><X size={13} /></button></span>}
        <textarea ref={inputRef} rows="1" value={text} maxLength={4000} placeholder={status === 'RESOLVED' ? 'Reply to reopen…' : 'Type a message'} aria-label="Message" onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !('ontouchstart' in window)) { event.preventDefault(); submit() } }} />
      </div>
      <button type="submit" className="hc-send" aria-label="Send" disabled={sending || (!text.trim() && !photo)}><ArrowUp size={20} /></button>
    </form>
  </div>
}

/** Floating help button + chat sheet (full screen on phones, card on larger screens). */
export function HelpChat({ open, onToggle }) {
  const conversation = useHelpConversation({ open })
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => { if (event.key === 'Escape') onToggle() }
    document.addEventListener('keydown', onKey)
    document.documentElement.classList.add('hc-open')
    return () => { document.removeEventListener('keydown', onKey); document.documentElement.classList.remove('hc-open') }
  }, [open, onToggle])
  return <div className="chat-widget hc-root">
    {!open && <button type="button" className="hc-launcher" aria-label={conversation.unread ? `Help chat, ${conversation.unread} new` : 'Help chat'} onClick={onToggle}>
      <MessageCircle size={24} aria-hidden="true" />
      {conversation.unread > 0 && <b>{conversation.unread}</b>}
    </button>}
    {open && createPortal(<>
      <div className="hc-backdrop" onClick={onToggle} aria-hidden="true" />
      <section className="hc-panel" role="dialog" aria-modal="true" aria-label="DOORSTEP Help chat">
        <HelpConversation conversation={conversation} onClose={onToggle} />
      </section>
    </>, document.body)}
  </div>
}

/** Full-page help (Account → Support). Same conversation as the floating chat. */
export function HelpPage({ embedded = false }) {
  const conversation = useHelpConversation({ open: true })
  const Shell = embedded ? 'section' : 'main'
  return <Shell className={`${embedded ? '' : 'route-page '}hc-page`}><HelpConversation conversation={conversation} fullPage /></Shell>
}
