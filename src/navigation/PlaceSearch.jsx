import { useEffect, useId, useRef, useState } from 'react'
import { MapPin, Search } from 'lucide-react'
import { navigationRequest } from './api'

export default function PlaceSearch({ label, value, onSelect, disabled = false }) {
  const id = useId()
  const [text, setText] = useState(value?.label || '')
  const [suggestions, setSuggestions] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [active, setActive] = useState(-1)
  const [focused, setFocused] = useState(false)
  const [changed, setChanged] = useState(false)
  const session = useRef(null)
  const request = useRef(null)

  useEffect(() => {
    if (!value && focused && changed) return
    setText(value?.label || '')
    setChanged(false)
    setSuggestions([])
  }, [value])

  useEffect(() => {
    if (!changed || !focused || text.trim().length < 3 || disabled) {
      setSuggestions([])
      return undefined
    }
    const controller = new AbortController()
    request.current?.abort()
    request.current = controller
    const timer = setTimeout(async () => {
      setBusy(true)
      setError('')
      try {
        session.current ||= crypto.randomUUID()
        const body = await navigationRequest(`/search?query=${encodeURIComponent(text.trim())}&sessionToken=${session.current}`, { signal: controller.signal })
        if (controller.signal.aborted) return
        setSuggestions(body.suggestions)
        setActive(-1)
        if (!body.suggestions.length) setError('No places found. Try a different address or pin it on the map.')
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure.message)
      } finally {
        if (!controller.signal.aborted) setBusy(false)
      }
    }, 400)
    return () => { clearTimeout(timer); controller.abort(); setBusy(false) }
  }, [text, changed, focused, disabled])

  useEffect(() => () => request.current?.abort(), [])

  async function select(suggestion) {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError('')
    setSuggestions([])
    try {
      const body = await navigationRequest(`/places/${encodeURIComponent(suggestion.placeId)}?sessionToken=${session.current}`, { signal: controller.signal })
      if (controller.signal.aborted) return
      onSelect(body.place)
      setText(body.place.label)
      setChanged(false)
      setFocused(false)
      session.current = null
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure.message)
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  return <div className="nav-place-search">
    <label htmlFor={id}>{label}</label>
    <div className="nav-search-input"><Search size={17} aria-hidden="true" />
      <input id={id} value={text} disabled={disabled || busy && !focused}
        role="combobox" aria-autocomplete="list" aria-expanded={suggestions.length > 0}
        aria-controls={`${id}-results`} aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        placeholder="Search address, business or place"
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); setActive(-1) }}
        onChange={(event) => { setText(event.target.value); setChanged(true); setError(''); if (value) onSelect(null) }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && suggestions.length) { event.preventDefault(); setActive((index) => (index + 1) % suggestions.length) }
          if (event.key === 'ArrowUp' && suggestions.length) { event.preventDefault(); setActive((index) => (index - 1 + suggestions.length) % suggestions.length) }
          if (event.key === 'Escape') { setSuggestions([]); setActive(-1) }
          if (event.key === 'Enter' && active >= 0 && suggestions[active]) { event.preventDefault(); select(suggestions[active]) }
        }} />
      {busy && <span className="nav-spinner" aria-label="Searching places" />}
    </div>
    {suggestions.length > 0 && <ul id={`${id}-results`} className="nav-suggestions" role="listbox" aria-label={`${label} suggestions`}>
      {suggestions.map((suggestion, index) => <li key={suggestion.placeId} role="option" id={`${id}-${index}`}
        aria-selected={active === index} onMouseDown={(event) => event.preventDefault()} onClick={() => select(suggestion)}>
        <MapPin size={17} aria-hidden="true" /><span>{suggestion.label}</span>
      </li>)}
    </ul>}
    {error && <small id={`${id}-error`} className="nav-field-error" role="status">{error}</small>}
  </div>
}
