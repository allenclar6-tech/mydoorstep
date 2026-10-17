import { useEffect, useState } from 'react'
import { Plus, Pencil, X } from 'lucide-react'
import { formatNaira } from './data'
import { PartnerImageUpload, partnerApiBase } from './PartnerImageUpload'

async function menuRequest(path = '', options = {}) {
  const response = await fetch(`${partnerApiBase}/api/restaurant/menu${path}`, { ...options, headers: { Authorization: `Bearer ${localStorage.getItem('doorstep-token')}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) }, signal: AbortSignal.timeout(20_000) })
  const body = await response.json()
  if (!response.ok) throw new Error(response.status === 400 ? 'Check the item name, description and price.' : 'Could not update your menu. Check your connection and try again.')
  return body
}

export function PartnerMenu() {
  const [items, setItems] = useState(null)
  const [grocery, setGrocery] = useState(false)
  const [editing, setEditing] = useState(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const load = async () => {
    setError('')
    try { const body = await menuRequest(); if (!Array.isArray(body.items)) throw new Error('The menu service returned an invalid response. Please try again.'); setItems(body.items) } catch (error) { setError(error.message) }
  }
  useEffect(() => {
    void load()
    const token = localStorage.getItem('doorstep-token')
    fetch(`${partnerApiBase}/api/restaurant/profile`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) })
      .then(async response => response.ok ? response.json() : null)
      .then(body => setGrocery(body?.restaurant?.storeType === 'GROCERY'))
      .catch(() => undefined)
  }, [])
  const itemLabel = grocery ? 'product' : 'item'
  const itemLabelCapitalized = grocery ? 'Product' : 'Item'
  const save = async event => {
    event.preventDefault()
    if (busy) return
    const values = Object.fromEntries(new FormData(event.currentTarget))
    setBusy(true); setError(''); setMessage('')
    try {
      const body = await menuRequest(editing ? `/${editing.id}` : '', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify({ name: values.name, description: values.description, priceMinor: Math.round(Number(values.price) * 100), ...(editing ? { available: values.available === 'on' } : {}) }) })
      if (editing ? !body.updated : !body.item) throw new Error('The item was not saved. Refresh and try again.')
      setEditing(null); setCreating(false)
      setMessage(`${itemLabelCapitalized} saved. You can now add or change its photo below.`)
      await load()
    } catch (error) { setError(error.message) } finally { setBusy(false) }
  }
  return <section className="partner-menu"><div className="portal-intro"><div><span className="section-kicker">{grocery ? 'GROCERY PRODUCT MEDIA' : 'MENU & PRODUCT MEDIA'}</span><h2>{grocery ? 'Your products, beautifully presented.' : 'Your items, beautifully presented.'}</h2><p>Manage {grocery ? 'product' : 'item'} details and upload clear photos customers can recognize.</p></div><button className="portal-primary" onClick={() => { setCreating(!creating); setEditing(null) }}>{creating ? <X size={18} /> : <Plus size={18} />}{creating ? 'Close' : `Add ${itemLabel}`}</button></div>
    {error && <p className="admin-login-error" role="alert">{error}</p>}{message && <p className="partner-save-message" role="status">{message}</p>}
    {(creating || editing) && <form key={editing?.id || 'new'} className="menu-form" onSubmit={save}><h3>{editing ? `Edit ${editing.name}` : `Create a ${itemLabel}`}</h3><label>{itemLabelCapitalized} name<input required name="name" minLength={2} maxLength={120} defaultValue={editing?.name || ''} /></label><label>Price in naira<input required name="price" type="number" min="0.01" step="0.01" defaultValue={editing ? editing.priceMinor / 100 : ''} /></label><label>Description<textarea name="description" rows={3} maxLength={500} defaultValue={editing?.description || ''} /></label>{editing && <label className="filter-check"><input type="checkbox" name="available" defaultChecked={editing.available} />Available to customers</label>}<p>Save the {itemLabel} first, then use its photo upload panel below.</p><button className="portal-primary" disabled={busy}>{busy ? 'Saving...' : `Save ${itemLabel}`}</button><button className="quiet-button" type="button" disabled={busy} onClick={() => { setEditing(null); setCreating(false) }}>Cancel</button></form>}
    {items === null ? <p role="status">{error ? `${itemLabelCapitalized} catalogue could not be loaded.` : `Loading your ${grocery ? 'product catalogue' : 'menu'}...`}</p> : items.length === 0 ? <div className="empty-state">No {grocery ? 'products' : 'items'} yet. Add your first {itemLabel} to upload a photo.</div> : items.map(item => <article className="partner-menu-item" key={item.id}><span className="portal-status">{item.available ? 'AVAILABLE' : 'HIDDEN'}</span><h3>{item.name}</h3><p>{item.description}</p><strong>{formatNaira(item.priceMinor / 100)}</strong><button className="quiet-button" onClick={() => { setEditing(item); setCreating(false); window.scrollTo({ top: 0, behavior: 'auto' }) }}><Pencil size={16} />Edit {itemLabel} details</button><PartnerImageUpload label={`${item.name} ${grocery ? 'product' : 'item'} photo`} endpoint={`/api/restaurant/menu/${item.id}/image`} imageEndpoint={item.imageUrl?.startsWith('/api/media/menu/') ? `/api/restaurant/menu/${item.id}/image` : undefined} initialImage={item.imageUrl?.startsWith('/api/media/menu/') ? undefined : item.imageUrl} onSaved={() => load()} /></article>)}
    {error && <button className="quiet-button" onClick={load}>Reload menu</button>}
  </section>
}
