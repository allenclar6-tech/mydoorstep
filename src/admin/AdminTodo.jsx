import { useEffect, useState } from 'react'
import { CheckCircle2, ChevronRight, CircleAlert } from 'lucide-react'
import { apiBase } from '../config/apiBase'

// Admin overview: a short “Things to do” list in plain words. Each line opens the page where it’s done.
const navigate = (path) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')) }

export function AdminTodo() {
  const [items, setItems] = useState(null)
  useEffect(() => {
    let token = null
    try { token = localStorage.getItem('doorstep-admin-token') } catch { token = null }
    const load = () => fetch(`${apiBase}/api/admin/todo`, { headers: { Authorization: `Bearer ${token}` } }).then((response) => response.ok ? response.json() : null).then((body) => { if (body) setItems(body.items) }).catch(() => undefined)
    load()
    const timer = window.setInterval(load, 60_000)
    return () => window.clearInterval(timer)
  }, [])
  if (!items) return null
  return <section className="admin-todo" aria-label="Things to do">
    <h3>{items.length ? 'Things to do' : 'All caught up'}</h3>
    {items.length === 0 ? <p className="admin-todo-done"><CheckCircle2 size={18} aria-hidden="true" />Nothing needs you right now.</p>
      : <ul>{items.map((item) => <li key={item.key} className={item.urgent ? 'is-urgent' : ''}><button type="button" onClick={() => navigate(item.href)}>
        <CircleAlert size={18} aria-hidden="true" /><span>{item.text}</span><b>{item.action}<ChevronRight size={15} aria-hidden="true" /></b>
      </button></li>)}</ul>}
  </section>
}
