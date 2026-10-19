import { useEffect, useRef, useState } from 'react'
import { Check, Layers, X } from 'lucide-react'
import { MAP_STYLES, probeStyles } from './mapStyles'
import { mapToken } from './mapConfig'

/**
 * Compact on-map Layers button. Opens a bottom sheet on phones and a popover on
 * larger screens. Styles that fail the Mapbox probe are shown as unavailable
 * with the reason, never presented as working.
 */
export function LayersControl({ controller, className = '' }) {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState(() => controller?.styleId || null)
  const [probe, setProbe] = useState(null)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const panelRef = useRef(null)
  const buttonRef = useRef(null)

  useEffect(() => {
    if (!controller) return undefined
    setCurrent(controller.styleId)
    return controller.onChange((id) => setCurrent(id))
  }, [controller])

  useEffect(() => {
    if (!open) return undefined
    let active = true
    if (!probe) probeStyles(mapToken).then((results) => { if (active) setProbe(results) })
    const onKey = (event) => { if (event.key === 'Escape') { setOpen(false); buttonRef.current?.focus() } }
    const onPointer = (event) => { if (!panelRef.current?.contains(event.target) && !buttonRef.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    window.requestAnimationFrame(() => panelRef.current?.querySelector('button[aria-pressed="true"], button:not([disabled])')?.focus())
    return () => { active = false; document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onPointer) }
  }, [open])

  if (!controller) return null
  const currentName = MAP_STYLES.find((style) => style.id === current)?.name || 'Map'

  const choose = async (style) => {
    if (style.id === current) { setOpen(false); return }
    setBusy(style.id)
    setMessage('')
    const result = await controller.switchStyle(style.id)
    setBusy('')
    if (result.ok) { setOpen(false); buttonRef.current?.focus() }
    else setMessage(`${style.name} could not load. ${result.message || ''} Your previous map style is still active.`)
  }

  const retryProbe = () => { setProbe(null); probeStyles(mapToken, { force: true }).then(setProbe) }

  return <div className={`map-layers${open ? ' is-open' : ''} ${className}`}>
    <button ref={buttonRef} type="button" className="map-layers-button" aria-haspopup="dialog" aria-expanded={open} aria-label={`Map layers. Current style: ${currentName}`} onClick={() => setOpen((value) => !value)}>
      <Layers size={18} aria-hidden="true" /><span>{currentName}</span>
    </button>
    {open && <div className="map-layers-backdrop" aria-hidden="true" />}
    {open && <section ref={panelRef} className="map-layers-panel" role="dialog" aria-modal="false" aria-label="Choose map style">
      <header><strong>Map style</strong><button type="button" className="map-layers-close" aria-label="Close map styles" onClick={() => setOpen(false)}><X size={17} /></button></header>
      {!probe && <p className="map-layers-note" role="status">Checking which styles your Mapbox account allows…</p>}
      <div className="map-layers-grid">
        {MAP_STYLES.map((style) => {
          const status = probe?.[style.id]
          const unavailable = status && !status.ok
          const selected = style.id === current
          return <button key={style.id} type="button" aria-pressed={selected} disabled={Boolean(busy) || unavailable} className={`map-layers-option${selected ? ' is-selected' : ''}${unavailable ? ' is-unavailable' : ''}`} onClick={() => choose(style)} title={unavailable ? status.reason : style.name}>
            <span className="map-layers-swatch" aria-hidden="true" style={{ background: `linear-gradient(135deg, ${style.swatch[0]} 0 45%, ${style.swatch[1]} 45% 70%, ${style.swatch[2]} 70%)` }}>{selected && <Check size={15} />}</span>
            <span className="map-layers-name">{style.name}</span>
            <small>{busy === style.id ? 'Loading…' : unavailable ? 'Unavailable' : selected ? 'In use' : status?.ok ? 'Available' : ''}</small>
          </button>
        })}
      </div>
      {probe && Object.values(probe).some((status) => !status.ok) && <p className="map-layers-note">
        {Object.values(probe).find((status) => !status.ok)?.reason} <button type="button" className="map-layers-retry" onClick={retryProbe}>Check again</button>
      </p>}
      {message && <p className="map-layers-error" role="alert">{message}</p>}
    </section>}
  </div>
}
