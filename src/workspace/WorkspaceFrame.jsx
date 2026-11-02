import { useEffect, useState } from 'react'
import { ChevronRight, Menu as MenuIcon, X } from 'lucide-react'
import { NotificationBell } from '../notifications/NotificationCenter'
import { WithdrawButton } from '../finance/WithdrawButton'
import { SessionSignOutButton } from '../authControls'
import '../partner/partnerHub.css'

// Shared frame for the partner and rider workspaces (Glovo-style):
// phone = yellow top bar + bottom tab bar + "More" sheet; desktop = white sidebar + top title bar.
// Styles live in partner/partnerHub.css (all classes start with ph-).

export const go = (path) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')) }
export const authHeaders = (json = false) => { let token = null; try { token = localStorage.getItem('doorstep-token') } catch { token = null } return { Authorization: `Bearer ${token}`, ...(json ? { 'Content-Type': 'application/json' } : {}) } }
export const naira = (minor) => `₦${Math.round((minor || 0) / 100).toLocaleString('en-NG')}`
export const shortNaira = (minor) => { const value = Math.round((minor || 0) / 100); return value >= 1_000_000 ? `₦${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}m` : value >= 1000 ? `₦${(value / 1000).toFixed(1).replace(/\.0$/, '')}k` : `₦${value}` }
export const timeOf = (value) => new Date(value).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' })
export const greeting = () => { const hour = new Date().getHours(); return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening' }
export const initials = (name = '') => name.replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase() || 'D'
export const firstNameOf = (user) => user?.preferredName || user?.firstName || ''

/** Closes a sheet with the Escape key. */
export function useEscape(open, close) { useEffect(() => { if (!open) return undefined; const onKey = (event) => { if (event.key === 'Escape') close() }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [open, close]) }

/** Runs `load` now, every `ms`, and whenever the tab becomes visible or the phone gets its connection back. */
export function usePolling(load, ms = 30_000) {
  useEffect(() => {
    load()
    const timer = setInterval(() => { if (!document.hidden) load() }, ms)
    const refresh = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('online', refresh)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('online', refresh) }
  }, [load, ms])
}

const statusLine = (status) => `${status.label}${status.detail ? ` · ${status.detail}` : ''}`

/**
 * nav:   [{ label, href, icon, active, count }] — the first four also form the phone tab bar.
 * extra: [{ label, href, icon }] — lower sidebar links and the phone "More" sheet.
 * status: { tone: 'open' | 'paused' | 'closed' | 'muted', label, detail }
 */
export function WorkspaceFrame({ path, home, brandSub, label, name, image, status, nav, extra, account, title, greetingName, withdrawHref, isHome, tabs, bellTokenKey = 'doorstep-token', admin = false, children }) {
  const tabItems = tabs ? tabs.map((href) => nav.find((item) => item.href === href)).filter(Boolean) : nav.slice(0, 4)
  const moreItems = [...nav.filter((item) => !tabItems.includes(item)), ...extra]
  // Menu items can carry a group name; a small heading is shown where the group changes.
  const withHeadings = (items, render) => items.map((item, index) => [item.group && item.group !== items[index - 1]?.group ? <span key={`h-${item.group}`} className="ph-nav-heading">{item.group}</span> : null, render(item)])
  const [moreOpen, setMoreOpen] = useState(false)
  useEscape(moreOpen, () => setMoreOpen(false))
  const link = (href) => (event) => { event.preventDefault(); setMoreOpen(false); go(href) }
  const Avatar = ({ size = '' }) => <span className={`ph-avatar ${size}`}>{image ? <img src={image} alt="" /> : initials(name)}<i className={`ph-dot is-${status.tone}`} aria-hidden="true" /></span>
  const heading = isHome ? `${greeting()}${greetingName ? `, ${greetingName}` : ''} 👋` : title || name

  return <div className="ph-shell">
    <aside className="ph-side" aria-label={`${label} menu`}>
      <a className="ph-brand" href={home} onClick={link(home)}><span className="ph-mark" aria-hidden="true" /><span>DOORSTEP<small>{brandSub}</small></span></a>
      <div className="ph-store"><Avatar /><span><b>{name}</b><small className={`ph-status-text is-${status.tone}`}>{statusLine(status)}</small></span></div>
      <nav className="ph-nav">{withHeadings(nav, ({ label: text, href, icon: Icon, active, count }) => <a key={href} href={href} className={active ? 'is-active' : ''} aria-current={active ? 'page' : undefined} onClick={link(href)}><Icon size={19} aria-hidden="true" /><span>{text}</span>{count > 0 && <b className="ph-count">{count}</b>}</a>)}</nav>
      <nav className="ph-nav ph-nav-low">{extra.map(({ label: text, href, icon: Icon }) => <a key={href} href={href} className={path === href ? 'is-active' : ''} onClick={link(href)}><Icon size={18} aria-hidden="true" /><span>{text}</span></a>)}<SessionSignOutButton className="ph-signout" admin={admin} /></nav>
    </aside>

    <div className="ph-main-wrap">
      <header className="ph-top">
        <button type="button" className="ph-top-store" onClick={() => go(account.href)} aria-label={account.label}>
          <Avatar size="is-sm" />
          <span><b>{isHome ? name : title || name}</b><small className={`is-${status.tone}`}>{isHome ? statusLine(status) : name}</small></span>
        </button>
        <h1 className="ph-top-title">{heading}</h1>
        <div className="ph-top-actions">{withdrawHref && <span className="ph-hide-sm"><WithdrawButton earningsHref={withdrawHref} /></span>}<NotificationBell tokenKey={bellTokenKey} className="ph-icon-btn" label={`${label} notifications`} /></div>
      </header>
      <main className="portal-main ph-main">{isHome ? children : <div className="ph-inner">{children}</div>}</main>
    </div>

    <nav className="ph-tabs" aria-label={`${label} navigation`}>
      {tabItems.map(({ label: text, short, href, icon: Icon, active, count }) => <a key={href} href={href} className={active ? 'is-active' : ''} aria-current={active ? 'page' : undefined} onClick={link(href)}><span className="ph-tab-icon"><Icon size={21} aria-hidden="true" />{count > 0 && <b>{count}</b>}</span><span>{short || text}</span></a>)}
      <button type="button" className={moreOpen ? 'is-active' : ''} onClick={() => setMoreOpen(true)}><span className="ph-tab-icon"><MenuIcon size={21} aria-hidden="true" /></span><span>More</span></button>
    </nav>

    {moreOpen && <div className="ph-sheet-layer" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setMoreOpen(false) }}>
      <section className="ph-sheet" role="dialog" aria-modal="true" aria-label="More">
        <header><Avatar /><span><b>{name}</b><small className={`is-${status.tone}`}>{statusLine(status)}</small></span><button type="button" className="ph-icon-btn" onClick={() => setMoreOpen(false)} aria-label="Close"><X size={18} /></button></header>
        <div className="ph-sheet-list">
          {withHeadings(moreItems, ({ label: text, href, icon: Icon, count }) => <button key={href} type="button" className={path === href ? 'is-current' : ''} onClick={link(href)}><span className="ph-sheet-icon"><Icon size={18} aria-hidden="true" /></span>{text}{count > 0 ? <b className="ph-count">{count}</b> : <ChevronRight size={16} aria-hidden="true" />}</button>)}
          <SessionSignOutButton className="ph-sheet-signout" admin={admin} />
        </div>
      </section>
    </div>}
  </div>
}

/** Greeting line shown on phones (desktop shows it in the top bar). */
export function Hello({ name }) {
  return <div className="ph-hello"><h2>{greeting()}{name ? `, ${name}` : ''} 👋</h2><p>{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p></div>
}

/** Seven bars, today highlighted. week: [{ day, label, amountMinor }] */
export function WeekChart({ title = 'Last 7 days', summary, week, linkLabel, linkHref }) {
  const max = Math.max(...week.map((day) => day.amountMinor), 1)
  return <section className="ph-card">
    <div className="ph-card-head"><div><h3>{title}</h3>{summary && <p>{summary}</p>}</div>{linkHref && <button type="button" className="ph-link" onClick={() => go(linkHref)}>{linkLabel}<ChevronRight size={15} aria-hidden="true" /></button>}</div>
    <div className="ph-bars" role="img" aria-label={`${title}: ${week.map((day) => `${day.label} ${naira(day.amountMinor)}`).join(', ')}`}>
      {week.map((day) => <div key={day.day} className={`ph-bar${day.label === 'Today' ? ' is-today' : ''}`}>
        <span className="ph-bar-value">{day.amountMinor ? shortNaira(day.amountMinor) : ''}</span>
        <span className="ph-bar-track"><i style={{ height: `${Math.max(day.amountMinor ? 6 : 0, Math.round((day.amountMinor / max) * 100))}%` }} /></span>
        <span className="ph-bar-label">{day.label}</span>
      </div>)}
    </div>
  </section>
}

/** Big friendly illustrated shortcut tiles. items: [{ art, title, hint, href, tone }] */
export function Shortcuts({ items }) {
  return <section className="ph-shortcuts" aria-label="Shortcuts">{items.map(({ art: Art, title, hint, href, tone }) => <button key={href} type="button" className={`ph-shortcut is-${tone}`} onClick={() => go(href)}>
    <span className="ph-shortcut-art" aria-hidden="true"><Art /></span>
    <b>{title}</b><small>{hint}</small>
  </button>)}</section>
}
