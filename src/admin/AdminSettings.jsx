import { useEffect, useState } from 'react'
import { BarChart3, Bell, Calculator, ChevronRight, CreditCard, Download, FileText, Globe, LogOut, MapPin, Scale, ShieldCheck, Tag, Wallet } from 'lucide-react'
import { apiBase } from '../config/apiBase'
import { signOut } from '../services/authService'
import { COVERAGE_LABEL } from '../../server/coverage.js'
import { go, initials } from '../workspace/WorkspaceFrame'

// Admin › Settings: one tidy list (Glovo-style) of every setting that really controls DOORSTEP, each opening the page
// where it's changed. Rows show a live "to do" badge from the admin to-do list, so problems are visible here too.

const headers = () => { let token = null; try { token = localStorage.getItem('doorstep-admin-token') } catch { token = null } return { Authorization: `Bearer ${token}` } }

const GROUPS = [
  { title: 'Money', rows: [
    { icon: Wallet, label: 'Commission & payouts', hint: 'DOORSTEP’s share, rider pay, withdrawals and refunds', href: '/admin/finance' },
    { icon: CreditCard, label: 'How customers pay', hint: 'Card (Paystack) and bank transfer', href: '/admin/payments' },
    { icon: Tag, label: 'Promo codes', hint: 'Free delivery and discounts', href: '/admin/promos' },
  ] },
  { title: 'Delivery', rows: [
    { icon: Calculator, label: 'Delivery prices', hint: 'Customer fee by distance and rider pay per trip', href: '/admin/pricing' },
    { icon: MapPin, label: 'Places & areas', hint: 'LGAs, communities and streets; import a spreadsheet', href: '/admin/locations' },
    { icon: Globe, label: 'Where DOORSTEP works', hint: COVERAGE_LABEL, href: null },
  ] },
  { title: 'This phone or computer', rows: [
    { icon: Bell, label: 'Notifications', hint: 'Alerts for new orders, riders and messages', href: '/admin/notifications' },
    { icon: Download, label: 'Get the admin app', hint: 'Install DOORSTEP Admin on Android, iPhone or computer', href: '/admin/download' },
  ] },
  { title: 'Records & help', rows: [
    { icon: BarChart3, label: 'Sales report', hint: 'Sales and DOORSTEP’s share over time', href: '/admin/analytics' },
    { icon: FileText, label: 'Activity log', hint: 'Who changed what, and when', href: '/admin/audit-logs' },
    { icon: ShieldCheck, label: 'Privacy Policy', hint: 'What customers agree to', href: '/privacy', external: true },
    { icon: Scale, label: 'Terms and Conditions', hint: 'Rules for customers, partners and riders', href: '/terms', external: true },
  ] },
]

function useAccount() {
  const [user, setUser] = useState(null)
  useEffect(() => { fetch(`${apiBase}/api/auth/me`, { headers: headers() }).then((response) => response.ok ? response.json() : null).then((body) => { if (body?.user) setUser(body.user) }).catch(() => undefined) }, [])
  return user
}

/** Open to-do counts per page, from the admin to-do list (e.g. "Delivery prices are OFF"). */
function useTodoCounts() {
  const [counts, setCounts] = useState({})
  useEffect(() => {
    fetch(`${apiBase}/api/admin/todo`, { headers: headers() }).then((response) => response.ok ? response.json() : null).then((body) => {
      const next = {}
      for (const item of body?.items || []) if (item.count > 0 && item.href) next[item.href] = (next[item.href] || 0) + item.count
      setCounts(next)
    }).catch(() => undefined)
  }, [])
  return counts
}

export function AdminSettings() {
  const user = useAccount()
  const counts = useTodoCounts()
  const [leaving, setLeaving] = useState(false)
  const name = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'DOORSTEP owner' : 'DOORSTEP owner'
  const open = (row) => { if (!row.href) return; if (row.external) window.open(row.href, '_blank', 'noopener'); else go(row.href) }
  return <div className="ph-page as-page">
    <section className="as-profile">
      <span className="as-avatar" aria-hidden="true">{initials(name)}</span>
      <div><b>{name}</b><small>{user?.email || 'Admin account'}</small><span className="as-role"><ShieldCheck size={13} aria-hidden="true" />Owner · full access</span></div>
    </section>

    {GROUPS.map((group) => <section key={group.title} className="as-group" aria-labelledby={`as-${group.title}`}>
      <h3 id={`as-${group.title}`}>{group.title}</h3>
      <ul>{group.rows.map((row) => {
        const Icon = row.icon
        const badge = row.href ? counts[row.href] : 0
        const inner = <>
          <span className="as-icon" aria-hidden="true"><Icon size={19} /></span>
          <span className="as-text"><b>{row.label}</b><small>{row.hint}</small></span>
          {badge > 0 && <span className="as-badge">{badge} to do</span>}
          {row.href && <ChevronRight size={18} aria-hidden="true" className="as-chev" />}
        </>
        return <li key={row.label}>{row.href ? <button type="button" className="as-row" onClick={() => open(row)}>{inner}</button> : <div className="as-row is-static">{inner}</div>}</li>
      })}</ul>
    </section>)}

    <section className="as-group">
      <ul><li><button type="button" className="as-row is-danger" disabled={leaving} onClick={() => { setLeaving(true); signOut({ apiBase, admin: true }) }}>
        <span className="as-icon" aria-hidden="true"><LogOut size={19} /></span>
        <span className="as-text"><b>{leaving ? 'Signing out…' : 'Sign out of this device'}</b><small>You’ll need your password to come back in</small></span>
      </button></li></ul>
    </section>
    <p className="ph-foot">Every change you make on these pages is saved in the Activity log with your name and the time.</p>
  </div>
}
