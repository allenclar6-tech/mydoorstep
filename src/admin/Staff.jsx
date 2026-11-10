import { useCallback, useEffect, useState } from 'react'
import { UserPlus } from 'lucide-react'
import { apiBase } from '../config/apiBase'
import './staff.css'

// Admin › Staff & roles (Super admin only — the server refuses everyone else).

const headers = () => { let token = null; try { token = localStorage.getItem('doorstep-admin-token') } catch { token = null } return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
async function call(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, { ...options, headers: headers() })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.message || (response.status === 403 ? 'Only a Super admin can manage staff.' : 'That didn’t work. Try again.'))
  return body
}

export function Staff() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', adminRole: 'DISPATCH_OPERATOR' })
  const [busy, setBusy] = useState('')
  const load = useCallback(() => call('/api/admin/staff').then(setData).catch((loadError) => setError(loadError.message)), [])
  useEffect(() => { load() }, [load])

  const add = async (event) => {
    event.preventDefault(); setBusy('add'); setError(''); setNotice('')
    try { const body = await call('/api/admin/staff', { method: 'POST', body: JSON.stringify({ ...form, lastName: form.lastName || undefined }) }); setNotice(`${body.staff.firstName} added as ${body.staff.roleName}. ${body.next}`); setAdding(false); setForm({ firstName: '', lastName: '', email: '', adminRole: 'DISPATCH_OPERATOR' }); load() } catch (addError) { setError(addError.message) } finally { setBusy('') }
  }
  const change = async (person, patch, question) => {
    if (question && !window.confirm(question)) return
    setBusy(person.id); setError(''); setNotice('')
    try { await call(`/api/admin/staff/${person.id}`, { method: 'PATCH', body: JSON.stringify(patch) }); setNotice('Saved.'); load() } catch (changeError) { setError(changeError.message) } finally { setBusy('') }
  }

  return <div className="st">
    <div className="st-head">
      <p>Each person sees only the pages their role needs. The server checks every action, so hiding a page isn’t the only protection.</p>
      <button type="button" className="st-btn is-primary" onClick={() => setAdding((value) => !value)}><UserPlus size={16} />Add staff</button>
    </div>
    {notice && <p className="st-ok" role="status">{notice}</p>}
    {error && <p className="st-alert" role="alert">{error}</p>}

    {adding && data && <form className="st-card st-form" onSubmit={add}>
      <h3>Add a staff member</h3>
      <div className="st-grid">
        <label>First name<input required maxLength={60} value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} /></label>
        <label>Last name<input maxLength={60} value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} /></label>
        <label className="is-wide">Work email<input required type="email" maxLength={160} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="name@yourcompany.com" /></label>
      </div>
      <fieldset className="st-roles"><legend>Role</legend>{data.roles.map((role) => <label key={role.role} className={form.adminRole === role.role ? 'is-on' : ''}><input type="radio" name="role" value={role.role} checked={form.adminRole === role.role} onChange={() => setForm({ ...form, adminRole: role.role })} /><span><b>{role.name}</b><small>{role.does}</small></span></label>)}</fieldset>
      <p className="st-muted">Use a work email that isn’t already a customer, business or rider account. They’ll set their password with “Forgot password” on the admin sign-in page.</p>
      <div className="st-actions"><button type="submit" className="st-btn is-primary" disabled={busy === 'add'}>{busy === 'add' ? 'Adding…' : 'Add staff member'}</button><button type="button" className="st-btn" onClick={() => setAdding(false)}>Cancel</button></div>
    </form>}

    {!data && !error && <div className="st-skeleton" role="status" aria-label="Loading staff"><span /><span /></div>}
    {data && <section className="st-card">
      <table className="st-table">
        <thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col"><span className="st-sr">Actions</span></th></tr></thead>
        <tbody>{data.staff.map((person) => <tr key={person.id} className={person.status !== 'ACTIVE' ? 'is-off' : ''}>
          <th scope="row"><b>{`${person.firstName} ${person.lastName || ''}`.trim()}</b><small>{person.email}{person.hasPassword ? '' : ' · hasn’t set a password yet'}</small></th>
          <td data-label="Role"><select aria-label={`Role for ${person.firstName}`} value={person.adminRole} disabled={busy === person.id} onChange={(event) => change(person, { adminRole: event.target.value }, `Change ${person.firstName}’s role to ${data.roles.find((role) => role.role === event.target.value).name}?`)}>{data.roles.map((role) => <option key={role.role} value={role.role}>{role.name}</option>)}</select></td>
          <td data-label="Status"><span className={`st-pill is-${person.status.toLowerCase()}`}>{person.status === 'ACTIVE' ? 'Active' : 'Suspended'}</span></td>
          <td className="st-row-actions">{person.status === 'ACTIVE'
            ? <button type="button" className="st-btn is-quiet" disabled={busy === person.id} onClick={() => change(person, { status: 'SUSPENDED' }, `Suspend ${person.firstName}? They’ll be signed out straight away.`)}>Suspend</button>
            : <button type="button" className="st-btn is-quiet" disabled={busy === person.id} onClick={() => change(person, { status: 'ACTIVE' })}>Reactivate</button>}</td>
        </tr>)}</tbody>
      </table>
    </section>}

    {data && <section className="st-card"><h3>What each role can do</h3><dl className="st-legend">{data.roles.map((role) => <div key={role.role}><dt>{role.name}</dt><dd>{role.does}</dd></div>)}</dl></section>}
  </div>
}
