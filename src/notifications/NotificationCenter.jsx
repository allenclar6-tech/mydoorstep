import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Bell, BellRing, Bike, Check, CheckCheck, ChevronRight, CreditCard, MessageCircle, ShieldCheck, ShoppingBag, Tag, UserCheck, X } from 'lucide-react'
import { apiBase } from '../config/apiBase'
import { alertKindFor, playAlert } from './sound'

const POLL_MS = 20_000
const PAGE_SIZE = 20

const typeMeta = {
  ORDER: { icon: ShoppingBag, label: 'Order', tone: 'order' },
  DELIVERY: { icon: Bike, label: 'Delivery', tone: 'delivery' },
  PAYMENT: { icon: CreditCard, label: 'Payment', tone: 'payment' },
  ACCOUNT: { icon: UserCheck, label: 'Account', tone: 'account' },
  SYSTEM: { icon: MessageCircle, label: 'Support', tone: 'system' },
  SECURITY: { icon: ShieldCheck, label: 'Security', tone: 'security' },
  PROMOTION: { icon: Tag, label: 'Offer', tone: 'promotion' },
}

const navigate = (path) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')) }
const readToken = (key) => { try { return localStorage.getItem(key) } catch { return null } }

/* ---------------------------------------------------------------------------------------
 * One store per session token (customer/partner/rider share 'doorstep-token', admin uses
 * 'doorstep-admin-token'). Every bell, badge and inbox on screen reads the same store, so the
 * server is polled once however many places show the count.
 * ------------------------------------------------------------------------------------- */
const stores = new Map()

function createStore(tokenKey) {
  let state = { items: [], unreadCount: 0, loaded: false, loading: false, nextCursor: null, error: '', toast: null }
  let subscribers = new Set()
  let timer = null
  let sessionToken = null
  let newestId = null
  let stopped = false
  const listeners = []

  const set = (patch) => { state = { ...state, ...patch }; subscribers.forEach((notify) => notify()) }
  const request = async (path, options = {}) => {
    const token = readToken(tokenKey)
    if (!token) throw Object.assign(new Error('signed out'), { status: 401 })
    const response = await fetch(`${apiBase}${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) } })
    if (response.status === 401) throw Object.assign(new Error('session expired'), { status: 401 })
    if (!response.ok) throw new Error('Notifications are not available right now.')
    return response.status === 204 ? null : response.json()
  }

  // A different (or no) session means a different inbox: start again from nothing.
  const syncSession = () => {
    const token = readToken(tokenKey)
    if (token === sessionToken) return Boolean(token)
    sessionToken = token
    newestId = null
    stopped = false
    state = { items: [], unreadCount: 0, loaded: false, loading: false, nextCursor: null, error: '', toast: null }
    subscribers.forEach((notify) => notify())
    return Boolean(token)
  }

  const announcedIds = new Set()
  const announce = (notification) => {
    if (announcedIds.has(notification.id)) return
    announcedIds.add(notification.id)
    set({ toast: notification })
    // Every side hears new notifications: a chime for customers/admins, a bell for businesses, an alarm for riders.
    playAlert(alertKindFor(notification))
    if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        const alert = new Notification(notification.title, { body: notification.body, tag: notification.id, icon: '/doorstep-icon.svg', silent: false, renotify: true, requireInteraction: alertKindFor(notification) === 'job', vibrate: alertKindFor(notification) === 'job' ? [700, 150, 700, 150, 1000] : [200] })
        alert.onclick = () => { window.focus(); if (notification.link) navigate(notification.link); alert.close() }
      } catch { /* some mobile browsers only allow notifications from a service worker */ }
    }
  }

  const poll = async () => {
    if (!syncSession() || stopped || document.hidden) return
    try {
      const body = await request(`/api/notifications/summary${newestId ? `?since=${encodeURIComponent(newestId)}` : ''}`)
      const known = new Set(state.items.map((item) => item.id))
      const fresh = (body.latest || []).filter((item) => !known.has(item.id))
      const hadBaseline = Boolean(newestId)
      if (body.latest?.[0]) newestId = body.latest[0].id
      set({ unreadCount: body.unreadCount, items: hadBaseline && fresh.length ? [...fresh, ...state.items] : state.items, error: '' })
      // Announce what arrives while the page is open. On first load only something from the last
      // few minutes (such as the welcome message after signing up) is shown, never the backlog.
      if (hadBaseline && fresh.length) announce(fresh[0])
      else if (!hadBaseline && body.latest?.[0] && !body.latest[0].readAt && Date.now() - new Date(body.latest[0].createdAt).getTime() < 5 * 60_000 && !announcedIds.has(body.latest[0].id)) announce(body.latest[0])
    } catch (error) {
      if (error.status === 401) { stopped = true; set({ unreadCount: 0 }) }
    }
  }

  const loadPage = async (cursor = null) => {
    if (!syncSession() || state.loading) return
    set({ loading: true, error: '' })
    try {
      const body = await request(`/api/notifications?limit=${PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
      const items = cursor ? [...state.items, ...body.notifications.filter((item) => !state.items.some((existing) => existing.id === item.id))] : body.notifications
      if (!cursor && items[0]) newestId = items[0].id
      set({ items, unreadCount: body.unreadCount ?? items.filter((item) => !item.readAt).length, nextCursor: body.nextCursor, loaded: true, loading: false })
    } catch (error) {
      set({ loading: false, error: error.status === 401 ? 'Sign in again to see your notifications.' : error.message })
    }
  }

  const markRead = async (id) => {
    const target = state.items.find((item) => item.id === id)
    if (!target || target.readAt) return
    const readAt = new Date().toISOString()
    set({ items: state.items.map((item) => item.id === id ? { ...item, readAt } : item), unreadCount: Math.max(0, state.unreadCount - 1) })
    try { await request(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' }) } catch { poll() }
  }

  const markAll = async () => {
    if (!state.unreadCount) return
    const readAt = new Date().toISOString()
    set({ items: state.items.map((item) => item.readAt ? item : { ...item, readAt }), unreadCount: 0 })
    try { await request('/api/notifications/read-all', { method: 'POST' }) } catch { loadPage() }
  }

  const onVisible = () => { if (!document.hidden) poll() }
  const start = () => {
    syncSession()
    poll()
    timer = window.setInterval(poll, POLL_MS)
    const pairs = [[document, 'visibilitychange', onVisible], [window, 'focus', poll], [window, 'online', poll], [window, 'doorstep-notifications-change', poll], [window, 'storage', poll]]
    pairs.forEach(([target, name, handler]) => { target.addEventListener(name, handler); listeners.push(() => target.removeEventListener(name, handler)) })
  }
  const stop = () => { window.clearInterval(timer); timer = null; listeners.splice(0).forEach((remove) => remove()) }

  return {
    getState: () => state,
    subscribe(notify) {
      subscribers.add(notify)
      if (subscribers.size === 1) start()
      return () => { subscribers.delete(notify); if (!subscribers.size) stop() }
    },
    loadPage, markRead, markAll, poll,
    dismissToast: () => set({ toast: null }),
  }
}

function storeFor(tokenKey) {
  if (!stores.has(tokenKey)) stores.set(tokenKey, createStore(tokenKey))
  return stores.get(tokenKey)
}

const idleState = { items: [], unreadCount: 0, loaded: false, loading: false, nextCursor: null, error: '', toast: null }
const noop = () => () => undefined

/** Live notification state for the signed-in session. Pass enabled=false while signed out. */
export function useNotifications(tokenKey = 'doorstep-token', enabled = true) {
  const store = storeFor(tokenKey)
  const state = useSyncExternalStore(enabled ? store.subscribe : noop, enabled ? store.getState : () => idleState)
  return { ...state, loadPage: store.loadPage, markRead: store.markRead, markAll: store.markAll, refresh: store.poll, dismissToast: store.dismissToast }
}

/* ---------------------------------------------------------------------------------------
 * Presentation
 * ------------------------------------------------------------------------------------- */
const timeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
function relativeTime(value, now = Date.now()) {
  const seconds = Math.round((new Date(value).getTime() - now) / 1000)
  const abs = Math.abs(seconds)
  if (abs < 45) return 'Just now'
  if (abs < 3600) return timeFormatter.format(Math.round(seconds / 60), 'minute')
  if (abs < 86_400) return timeFormatter.format(Math.round(seconds / 3600), 'hour')
  if (abs < 604_800) return timeFormatter.format(Math.round(seconds / 86_400), 'day')
  return new Date(value).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })
}

function groupByDay(items) {
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)
  const startOfYesterday = new Date(startOfToday); startOfYesterday.setDate(startOfYesterday.getDate() - 1)
  const groups = [['Today', []], ['Yesterday', []], ['Earlier', []]]
  for (const item of items) {
    const created = new Date(item.createdAt)
    groups[created >= startOfToday ? 0 : created >= startOfYesterday ? 1 : 2][1].push(item)
  }
  return groups.filter(([, rows]) => rows.length)
}

function NotificationIcon({ type }) {
  const meta = typeMeta[type] || typeMeta.SYSTEM
  const Icon = meta.icon
  return <span className={`nc-icon is-${meta.tone}`} aria-hidden="true"><Icon size={18} strokeWidth={2.2} /></span>
}

function NotificationRow({ item, onOpen }) {
  const meta = typeMeta[item.type] || typeMeta.SYSTEM
  return <li>
    <button type="button" className={item.readAt ? 'nc-row' : 'nc-row is-unread'} onClick={() => onOpen(item)}>
      <NotificationIcon type={item.type} />
      <span className="nc-row-text">
        <span className="nc-row-top"><strong>{item.title}</strong><time dateTime={item.createdAt}>{relativeTime(item.createdAt)}</time></span>
        <span className="nc-row-body">{item.body}</span>
        <span className="nc-row-meta">{meta.label}{item.link && <><span aria-hidden="true">·</span><span className="nc-row-cta">View<ChevronRight size={13} aria-hidden="true" /></span></>}</span>
      </span>
      {!item.readAt && <span className="nc-dot"><span className="sr-only">Unread</span></span>}
    </button>
  </li>
}

function PushPrompt() {
  const supported = typeof Notification !== 'undefined'
  const [permission, setPermission] = useState(supported ? Notification.permission : 'unsupported')
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem('doorstep-alerts-prompt') === 'dismissed' } catch { return false } })
  if (!supported || permission !== 'default' || dismissed) return null
  const enable = async () => { try { setPermission(await Notification.requestPermission()) } catch { setPermission('denied') } }
  const dismiss = () => { setDismissed(true); try { localStorage.setItem('doorstep-alerts-prompt', 'dismissed') } catch { /* private mode */ } }
  return <div className="nc-push">
    <BellRing size={18} aria-hidden="true" />
    <p><strong>Get alerts on this device</strong><span>We will ping you while DOORSTEP is open in another tab.</span></p>
    <button type="button" className="nc-push-on" onClick={enable}>Turn on</button>
    <button type="button" className="nc-push-close" aria-label="Not now" onClick={dismiss}><X size={15} /></button>
  </div>
}

/** The full list with filters, grouping and paging. Used in the bell sheet and on inbox pages. */
export function NotificationInbox({ tokenKey = 'doorstep-token', onNavigate, compact = false }) {
  const { items, unreadCount, loaded, loading, nextCursor, error, loadPage, markRead, markAll } = useNotifications(tokenKey)
  const [filter, setFilter] = useState('all')
  useEffect(() => { loadPage() }, [loadPage])
  const open = (item) => {
    markRead(item.id)
    if (item.link) { onNavigate?.(); navigate(item.link) }
  }
  const visible = filter === 'unread' ? items.filter((item) => !item.readAt) : items
  return <div className={compact ? 'nc-inbox is-compact' : 'nc-inbox'}>
    <div className="nc-toolbar">
      <div className="nc-chips" role="tablist" aria-label="Filter notifications">
        <button type="button" role="tab" aria-selected={filter === 'all'} className={filter === 'all' ? 'is-active' : ''} onClick={() => setFilter('all')}>All</button>
        <button type="button" role="tab" aria-selected={filter === 'unread'} className={filter === 'unread' ? 'is-active' : ''} onClick={() => setFilter('unread')}>Unread{unreadCount > 0 && <b>{unreadCount > 99 ? '99+' : unreadCount}</b>}</button>
      </div>
      <button type="button" className="nc-mark-all" disabled={!unreadCount} onClick={markAll}><CheckCheck size={16} aria-hidden="true" />Mark all read</button>
    </div>
    <PushPrompt />
    {error && <p className="nc-error" role="alert">{error}</p>}
    {!loaded && loading && <ul className="nc-skeleton" aria-label="Loading notifications">{[0, 1, 2, 3].map((key) => <li key={key}><span /><span><i /><i /></span></li>)}</ul>}
    {loaded && visible.length === 0 && <div className="nc-empty">
      <span className="nc-empty-art" aria-hidden="true"><Bell size={30} /></span>
      <strong>{filter === 'unread' ? 'You’re all caught up' : 'Nothing here yet'}</strong>
      <p>{filter === 'unread' ? 'New updates will show up here the moment they happen.' : 'Order, delivery, payment and account updates will land here.'}</p>
    </div>}
    {groupByDay(visible).map(([label, rows]) => <section key={label} className="nc-group" aria-label={label}>
      <h3>{label}</h3>
      <ul>{rows.map((item) => <NotificationRow key={item.id} item={item} onOpen={open} />)}</ul>
    </section>)}
    {loaded && nextCursor && filter === 'all' && <button type="button" className="nc-more" disabled={loading} onClick={() => loadPage(nextCursor)}>{loading ? 'Loading…' : 'Show older'}</button>}
  </div>
}

/** Glovo-style drop-down toast for something that just happened. */
function NotificationToast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(onClose, 6000)
    return () => window.clearTimeout(timer)
  }, [toast, onClose])
  if (!toast) return null
  const openToast = () => { onClose(); if (toast.link) navigate(toast.link) }
  return createPortal(<div className="nc-toast" role="status" aria-live="polite">
    <button type="button" className="nc-toast-main" onClick={openToast}>
      <NotificationIcon type={toast.type} />
      <span><strong>{toast.title}</strong><span>{toast.body}</span></span>
    </button>
    <button type="button" className="nc-toast-close" aria-label="Dismiss" onClick={onClose}><X size={16} /></button>
  </div>, document.body)
}

/**
 * Header bell with an unread badge. Opens a drop-down panel on wide screens and a full-height
 * sheet on phones. Renders nothing while signed out.
 */
export function NotificationBell({ tokenKey = 'doorstep-token', className = 'nc-bell', label = 'Notifications' }) {
  const signedIn = Boolean(readToken(tokenKey))
  const { unreadCount, toast, dismissToast } = useNotifications(tokenKey, signedIn)
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const buttonRef = useRef(null)
  const panelRef = useRef(null)
  const close = useCallback(() => { setOpen(false); buttonRef.current?.focus() }, [])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => { if (event.key === 'Escape') close() }
    const onPointer = (event) => { if (!panelRef.current?.contains(event.target) && !buttonRef.current?.contains(event.target)) setOpen(false) }
    const onRoute = () => setOpen(false)
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    window.addEventListener('popstate', onRoute)
    document.documentElement.classList.add('nc-sheet-open')
    panelRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('popstate', onRoute)
      document.documentElement.classList.remove('nc-sheet-open')
    }
  }, [open, close])

  if (!signedIn) return null
  const badge = unreadCount > 99 ? '99+' : unreadCount
  return <>
    <button ref={buttonRef} type="button" className={`${className} nc-trigger${open ? ' is-open' : ''}`} aria-label={unreadCount ? `${label}, ${unreadCount} unread` : label} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>
      <Bell size={19} aria-hidden="true" />
      {unreadCount > 0 && <b className="nc-badge" aria-hidden="true">{badge}</b>}
    </button>
    {open && createPortal(<>
      <div className="nc-backdrop" aria-hidden="true" />
      <section ref={panelRef} id={panelId} className="nc-panel" role="dialog" aria-modal="false" aria-label={label} tabIndex={-1}>
        <header className="nc-panel-head">
          <h2>Notifications</h2>
          <button type="button" className="nc-close" aria-label="Close notifications" onClick={close}><X size={20} /></button>
        </header>
        <div className="nc-panel-body"><NotificationInbox tokenKey={tokenKey} onNavigate={() => setOpen(false)} compact /></div>
      </section>
    </>, document.body)}
    <NotificationToast toast={open ? null : toast} onClose={dismissToast} />
  </>
}

/** Full-page inbox for /account/notifications and the workspace notification screens. */
export function NotificationsScreen({ tokenKey = 'doorstep-token', title = 'Notifications', subtitle = 'Orders, deliveries, payments and account updates in one place.', children = null }) {
  return <main className="route-page account-app nc-screen">
    <header className="nc-screen-head">
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </header>
    <NotificationInbox tokenKey={tokenKey} />
    <p className="nc-screen-foot"><Check size={14} aria-hidden="true" />Updates arrive here automatically while DOORSTEP is open.</p>
    {children}
  </main>
}

/** Inbox screen inside the partner and rider workspaces. */
export function WorkspaceInbox({ title, subtitle, tokenKey = 'doorstep-token' }) {
  return <section className="ws-inbox">
    <header className="nc-screen-head"><h1>{title}</h1><p>{subtitle}</p></header>
    <NotificationInbox tokenKey={tokenKey} />
  </section>
}
