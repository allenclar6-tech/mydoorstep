import { useState } from 'react'
import { ListPlus, Plus, Trash2, X } from 'lucide-react'
import { partnerApiBase } from '../PartnerImageUpload'

const choicesUrl = (itemId) => `${partnerApiBase}/api/restaurant/menu/${itemId}/options`
const headers = (json) => ({ Authorization: `Bearer ${localStorage.getItem('doorstep-token')}`, ...(json ? { 'Content-Type': 'application/json' } : {}) })
const blankOption = () => ({ name: '', price: '', active: true })
const blankGroup = () => ({ name: '', required: true, maxSelect: 1, options: [blankOption(), blankOption()] })

/** Choice groups for one dish ("Choose your protein", "Extras"), edited in place and saved together. */
export function MenuChoices({ item }) {
  const [open, setOpen] = useState(false)
  const [groups, setGroups] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = async () => {
    setOpen(true); setError(''); setMessage('')
    try {
      const response = await fetch(choicesUrl(item.id), { headers: headers(), signal: AbortSignal.timeout(20_000) })
      if (!response.ok) throw new Error('Could not load the choices. Try again.')
      const body = await response.json()
      setGroups(body.groups.map((group) => ({ name: group.name, required: group.required, maxSelect: group.maxSelect, options: group.options.map((option) => ({ name: option.name, price: option.priceMinor ? String(option.priceMinor / 100) : '', active: option.active })) })))
    } catch (problem) { setError(problem.message); setGroups([]) }
  }
  const changeGroup = (index, patch) => setGroups(groups.map((group, position) => position === index ? { ...group, ...patch } : group))
  const changeOption = (groupIndex, optionIndex, patch) => changeGroup(groupIndex, { options: groups[groupIndex].options.map((option, position) => position === optionIndex ? { ...option, ...patch } : option) })

  const save = async () => {
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      const payload = { groups: groups.map((group) => {
        const options = group.options.filter((option) => option.name.trim()).map((option) => ({ name: option.name.trim(), priceMinor: Math.round((Number(option.price) || 0) * 100), active: option.active }))
        return { name: group.name.trim(), required: group.required, maxSelect: Math.max(1, Math.min(Number(group.maxSelect) || 1, options.length || 1)), options }
      }) }
      const response = await fetch(choicesUrl(item.id), { method: 'PUT', headers: headers(true), body: JSON.stringify(payload), signal: AbortSignal.timeout(20_000) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.message || 'Could not save the choices. Check your connection and try again.')
      setGroups(body.groups.map((group) => ({ name: group.name, required: group.required, maxSelect: group.maxSelect, options: group.options.map((option) => ({ name: option.name, price: option.priceMinor ? String(option.priceMinor / 100) : '', active: option.active })) })))
      setMessage(body.groups.length ? 'Choices saved. Customers will pick them before adding this item.' : 'Choices removed.')
    } catch (problem) { setError(problem.message) } finally { setBusy(false) }
  }

  if (!open) return <button type="button" className="quiet-button" onClick={load}><ListPlus size={16} />Choices &amp; extras</button>
  return <div className="menu-choices">
    <div className="menu-choices-head"><b>Choices &amp; extras for {item.name}</b><button type="button" className="quiet-button" onClick={() => setOpen(false)} aria-label="Close choices"><X size={16} /></button></div>
    <p className="menu-choices-hint">Add things like sizes, proteins or extras. Extra prices are added to the item price.</p>
    {error && <p className="admin-login-error" role="alert">{error}</p>}{message && <p className="partner-save-message" role="status">{message}</p>}
    {groups === null ? <p role="status">Loading choices...</p> : <>
      {groups.map((group, groupIndex) => <fieldset key={groupIndex} className="menu-choice-group">
        <label>Question customers answer<input value={group.name} maxLength={60} placeholder="e.g. Choose your protein" onChange={(event) => changeGroup(groupIndex, { name: event.target.value })} /></label>
        <div className="menu-choice-rules">
          <label className="filter-check"><input type="checkbox" checked={group.required} onChange={(event) => changeGroup(groupIndex, { required: event.target.checked })} />Customer must choose</label>
          <label>Up to<input type="number" min="1" max="20" value={group.maxSelect} onChange={(event) => changeGroup(groupIndex, { maxSelect: event.target.value })} /></label>
        </div>
        {group.options.map((option, optionIndex) => <div key={optionIndex} className="menu-choice-row">
          <input value={option.name} maxLength={60} placeholder="Choice, e.g. Chicken" aria-label="Choice name" onChange={(event) => changeOption(groupIndex, optionIndex, { name: event.target.value })} />
          <input type="number" min="0" step="1" value={option.price} placeholder="+₦0" aria-label="Extra price in naira" onChange={(event) => changeOption(groupIndex, optionIndex, { price: event.target.value })} />
          <label className="filter-check"><input type="checkbox" checked={option.active} onChange={(event) => changeOption(groupIndex, optionIndex, { active: event.target.checked })} />In stock</label>
          <button type="button" className="quiet-button" aria-label="Remove choice" onClick={() => changeGroup(groupIndex, { options: group.options.filter((_, position) => position !== optionIndex) })}><Trash2 size={15} /></button>
        </div>)}
        <div className="menu-choice-actions">
          <button type="button" className="quiet-button" disabled={group.options.length >= 30} onClick={() => changeGroup(groupIndex, { options: [...group.options, blankOption()] })}><Plus size={15} />Add choice</button>
          <button type="button" className="quiet-button" onClick={() => setGroups(groups.filter((_, position) => position !== groupIndex))}><Trash2 size={15} />Remove group</button>
        </div>
      </fieldset>)}
      <div className="menu-choice-actions">
        <button type="button" className="quiet-button" disabled={groups.length >= 10} onClick={() => setGroups([...groups, blankGroup()])}><Plus size={15} />Add a group</button>
        <button type="button" className="portal-primary" disabled={busy} onClick={save}>{busy ? 'Saving...' : 'Save choices'}</button>
      </div>
    </>}
  </div>
}
