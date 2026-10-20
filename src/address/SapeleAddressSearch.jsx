import { useId, useMemo, useState } from 'react'
import { MapPin } from 'lucide-react'
import { directoryAddressLine, searchDirectory } from '../../server/sapeleDirectory.js'

const TYPE_LABEL = { street: 'Street', place: 'Quarter / village', area: 'Area', estate: 'Estate / layout', landmark: 'Landmark' }
const LANDMARK_LABEL = { school: 'School', church: 'Church', market: 'Market', health: 'Hospital / clinic', hotel: 'Hotel', junction: 'Junction', bank: 'Bank', government: 'Public office', transport: 'Park / garage', park: 'Park', sport: 'Sports', community: 'Community centre', landmark: 'Landmark' }

/**
 * Address input with suggestions from the Sapele LGA directory (streets, quarters, areas, postcodes).
 * Works offline from the bundled directory; picking a suggestion fills a tidy address line.
 */
export function AddressSuggestInput({ value, onChange, onPick, name, required, placeholder = 'Street, area or postcode', autoFocus = false, className = '' }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()
  const lastPart = String(value || '').split(',')[0]
  const results = useMemo(() => open ? searchDirectory(lastPart, 6) : [], [open, lastPart])
  const pick = (result) => {
    const line = directoryAddressLine(result, lastPart)
    onChange(line)
    onPick?.(result, line)
    setOpen(false)
  }
  return <div className={`sa-wrap ${className}`}>
    <input name={name} required={required} value={value} autoFocus={autoFocus} autoComplete="off" placeholder={placeholder}
      role="combobox" aria-expanded={open && results.length > 0} aria-controls={listId} aria-autocomplete="list"
      onChange={(event) => { onChange(event.target.value); setOpen(true); setActive(0) }}
      onFocus={() => setOpen(true)}
      onBlur={() => setTimeout(() => setOpen(false), 150)}
      onKeyDown={(event) => {
        if (!open || !results.length) return
        if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => (index + 1) % results.length) }
        if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => (index - 1 + results.length) % results.length) }
        if (event.key === 'Enter') { event.preventDefault(); pick(results[active]) }
        if (event.key === 'Escape') setOpen(false)
      }} />
    {open && results.length > 0 && <ul className="sa-list" id={listId} role="listbox">
      {results.map((result, index) => <li key={`${result.name}-${result.areaId}`} role="option" aria-selected={index === active} className={index === active ? 'is-active' : ''} onMouseDown={(event) => { event.preventDefault(); pick(result) }}>
        <MapPin size={16} aria-hidden="true" />
        <span><b>{result.name}</b><small>{result.type !== 'area' ? `${result.type === 'landmark' ? LANDMARK_LABEL[result.kind] || 'Landmark' : TYPE_LABEL[result.type]} · ${result.areaName}` : 'Area'}{result.postcode ? ` · ${result.postcode}` : ''}{result.postcodeToConfirm ? ' (postcode to confirm)' : ''}</small></span>
      </li>)}
    </ul>}
  </div>
}
