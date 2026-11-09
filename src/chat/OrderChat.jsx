import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, Check, CheckCheck, LocateFixed, MapPin, MessageCircle, Phone, Send, ShieldCheck } from 'lucide-react'
import { apiBase } from '../config/apiBase'
import './orderChat.css'

// Order chat (Glovo-style). One component for every side:
//   customer ↔ rider  (channel CUSTOMER_RIDER) — from the customer's order screen and the rider's current job
//   store ↔ rider     (channel STORE_RIDER)    — from the business's live order card and the rider's current job
// The server decides who may read or write and when the chat opens/closes; this only shows what it returns.
// Messages refresh every 4 seconds while the chat is open (and every 20 seconds for the unread badge).

const authHeaders = () => { let token = null; try { token = localStorage.getItem('doorstep-token') } catch { token = null } return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
const ROLE_TEXT = { RIDER: 'Your DOORSTEP rider', CUSTOMER: 'Customer', STORE: 'Store' }
const time = (value) => new Date(value).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' })
const chatUrl = (ref, extra = '') => `${apiBase}/api/order-chat/${encodeURIComponent(ref)}${extra}`

function useChat(orderRef, channel, open) {
  const [chat, setChat] = useState(null)
  const [failed, setFailed] = useState(false)
  const load = useCallback(async () => {
    if (!orderRef) return
    try {
      const response = await fetch(`${chatUrl(orderRef)}?channel=${channel}`, { headers: authHeaders() })
      if (response.status === 403 || response.status === 404) { setChat({ hidden: true }); return }
      if (!response.ok) throw new Error()
      setChat(await response.json()); setFailed(false)
    } catch { setFailed(true) }
  }, [orderRef, channel])
  useEffect(() => {
    load()
    const timer = window.setInterval(() => { if (document.visibilityState !== 'hidden') load() }, open ? 4000 : 20000)
    return () => window.clearInterval(timer)
  }, [load, open])
  return { chat, failed, reload: load, setChat }
}

/** "Chat" button with an unread badge. Shows nothing while the chat isn't available for this person/order. */
export function OrderChatButton({ orderRef, channel = 'CUSTOMER_RIDER', label, phone, autoOpen = false, className = '' }) {
  const [open, setOpen] = useState(false)
  const { chat, failed, reload, setChat } = useChat(orderRef, channel, open)
  useEffect(() => { if (autoOpen && chat?.messages) setOpen(true) }, [autoOpen, Boolean(chat?.messages)])
  if (!chat || chat.hidden || (!chat.canSend && !chat.messages?.length)) return null
  const unread = chat.messages.filter((message) => !message.mine && !message.readAt).length
  const text = label || (chat.other?.role === 'RIDER' ? 'Chat with your rider' : chat.other?.role === 'STORE' ? 'Chat with the store' : 'Chat with the customer')
  return <>
    <button type="button" className={`oc-open ${className}`} onClick={() => setOpen(true)}>
      <MessageCircle size={17} aria-hidden="true" /><span>{text}</span>
      {unread > 0 && <b className="oc-badge" aria-label={`${unread} unread`}>{unread}</b>}
    </button>
    {open && <OrderChatSheet chat={chat} failed={failed} orderRef={orderRef} channel={channel} phone={phone} reload={reload} setChat={setChat} onClose={() => { setOpen(false); reload() }} />}
  </>
}

function OrderChatSheet({ chat, failed, orderRef, channel, phone, reload, setChat, onClose }) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [reporting, setReporting] = useState(null)
  const listRef = useRef(null)
  const count = chat.messages.length
  const unreadFromOther = chat.messages.some((message) => !message.mine && !message.readAt)

  useEffect(() => { listRef.current?.scrollTo?.({ top: listRef.current.scrollHeight }) }, [count])
  useEffect(() => {
    if (!unreadFromOther) return
    fetch(chatUrl(orderRef, '/read'), { method: 'POST', headers: authHeaders(), body: JSON.stringify({ channel }) }).then(reload).catch(() => undefined)
  }, [unreadFromOther, orderRef, channel])
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = previous }
  }, [onClose])

  const send = async (payload) => {
    if (busy) return
    setBusy(true); setNotice('')
    try {
      const response = await fetch(chatUrl(orderRef), { method: 'POST', headers: authHeaders(), body: JSON.stringify({ channel, ...payload }) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.message || (response.status === 409 ? 'This chat is closed.' : 'Your message wasn’t sent. Try again.'))
      setChat((current) => ({ ...current, messages: [...current.messages, body.message] }))
      if (payload.body != null) setDraft('')
      if (body.notice) setNotice(body.notice)
    } catch (error) { setNotice(error instanceof TypeError ? 'No internet — your message wasn’t sent.' : error.message); if (/closed/i.test(error.message)) reload() } finally { setBusy(false) }
  }
  const shareLocation = () => {
    if (!navigator.geolocation) { setNotice('Your phone can’t share its location here.'); return }
    setNotice('Getting your location…')
    navigator.geolocation.getCurrentPosition(
      (position) => send({ location: { latitude: position.coords.latitude, longitude: position.coords.longitude } }),
      () => setNotice('Location wasn’t shared. Allow location access for DOORSTEP and try again.'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    )
  }
  const report = async (reason) => {
    try {
      const response = await fetch(chatUrl(orderRef, '/report'), { method: 'POST', headers: authHeaders(), body: JSON.stringify({ channel, messageId: reporting, reason }) })
      setNotice(response.ok ? 'Thanks — DOORSTEP will look at this message.' : 'Couldn’t send the report. Try again or contact Help.')
    } catch { setNotice('Couldn’t send the report. Try again or contact Help.') }
    setReporting(null)
  }

  return <div className="oc-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="oc-sheet" role="dialog" aria-modal="true" aria-labelledby="oc-title">
      <header className="oc-head">
        <button type="button" className="oc-icon" onClick={onClose} aria-label="Close chat"><ArrowLeft size={20} /></button>
        <span className="oc-who"><b id="oc-title">{chat.other?.name}</b><small>{ROLE_TEXT[chat.other?.role]} · {chat.orderNumber}</small></span>
        {phone && <a className="oc-icon oc-call" href={`tel:${phone}`} aria-label={`Call ${chat.other?.name}`}><Phone size={18} /></a>}
      </header>

      <div className="oc-list" ref={listRef} aria-live="polite">
        <p className="oc-safety"><ShieldCheck size={15} aria-hidden="true" />Chat is only for this order. Phone numbers, account numbers and links are hidden. Never pay outside DOORSTEP.</p>
        {!count && <p className="oc-empty">{chat.canSend ? 'No messages yet. Tap a quick reply or type below.' : chat.closedText}</p>}
        {chat.messages.map((message) => <div key={message.id} className={`oc-msg ${message.mine ? 'is-mine' : 'is-theirs'}`}>
          <div className="oc-bubble">
            {message.kind === 'LOCATION' && message.location ? <a className="oc-location" href={`https://www.google.com/maps/search/?api=1&query=${message.location.latitude},${message.location.longitude}`} target="_blank" rel="noreferrer"><MapPin size={16} aria-hidden="true" /><span><b>{message.body}</b><small>Open in Maps</small></span></a> : <span>{message.body}</span>}
          </div>
          <small className="oc-meta">{time(message.createdAt)}{message.mine && (message.readAt ? <CheckCheck size={14} aria-label="Read" className="is-read" /> : <Check size={14} aria-label="Sent" />)}{!message.mine && <button type="button" className="oc-report" onClick={() => setReporting(message.id)}>Report</button>}</small>
        </div>)}
      </div>

      {reporting && <div className="oc-report-box" role="group" aria-label="Report this message">
        <b><AlertTriangle size={15} aria-hidden="true" /> What’s wrong with this message?</b>
        <div>{['Rude or abusive', 'Asked me to pay outside DOORSTEP', 'Spam or unsafe'].map((reason) => <button key={reason} type="button" onClick={() => report(reason)}>{reason}</button>)}</div>
        <button type="button" className="oc-cancel" onClick={() => setReporting(null)}>Cancel</button>
      </div>}

      {notice && <p className="oc-notice" role="status">{notice}</p>}
      {failed && <p className="oc-notice" role="status">Reconnecting…</p>}

      {chat.canSend ? <footer className="oc-compose">
        {chat.quickReplies?.length > 0 && <div className="oc-quick" aria-label="Quick replies">{chat.quickReplies.map((text, index) => <button key={text} type="button" disabled={busy} onClick={() => send({ quickReply: index })}>{text}</button>)}</div>}
        <form className="oc-form" onSubmit={(event) => { event.preventDefault(); if (draft.trim()) send({ body: draft }) }}>
          <button type="button" className="oc-icon" onClick={shareLocation} disabled={busy} aria-label="Share my location"><LocateFixed size={19} /></button>
          <input value={draft} onChange={(event) => setDraft(event.target.value.slice(0, chat.maxLength || 500))} placeholder="Type a message" aria-label="Message" enterKeyHint="send" />
          <button type="submit" className="oc-send" disabled={busy || !draft.trim()} aria-label="Send"><Send size={18} /></button>
        </form>
      </footer> : <footer className="oc-closed">{chat.closedText}</footer>}
    </section>
  </div>
}
