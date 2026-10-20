import { useEffect, useRef, useState } from 'react'

// Opening and closing times as hour / minute / AM-PM choices that start empty. The phone's own time
// picker opened on the current time and saved it as soon as OK was tapped (stores ended up closing at
// odd times like 20:28), and it showed 24-hour time on phones set that way.
// The form still submits `HH:mm` (24-hour) under `name`, exactly as the native input did.

const HOURS = Array.from({ length: 12 }, (_, index) => String(index + 1))
const MINUTES = Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, '0'))

function split(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value || '')
  if (!match) return { hour: '', minute: '', period: '' }
  const hours = Number(match[1])
  return { hour: String(hours % 12 || 12), minute: match[2], period: hours < 12 ? 'AM' : 'PM' }
}

function join({ hour, minute, period }) {
  if (!hour || !period) return ''
  const hours = (Number(hour) % 12) + (period === 'PM' ? 12 : 0)
  return `${String(hours).padStart(2, '0')}:${minute || '00'}`
}

/** "20:30" → "8:30 PM". Leaves anything it doesn't recognise unchanged. */
export function formatTime12(value) {
  const parts = split(value)
  return parts.hour ? `${parts.hour}:${parts.minute} ${parts.period}` : value || ''
}

export function TimeSelect({ name, label, defaultValue = '' }) {
  const [parts, setParts] = useState(() => split(defaultValue))
  const valueField = useRef(null)
  const value = join(parts)

  // Saved application drafts are restored by setting the field's value directly; pick that up.
  useEffect(() => {
    const field = valueField.current
    if (!field) return undefined
    const sync = () => { if (field.value !== join(parts)) setParts(split(field.value)) }
    field.addEventListener('input', sync)
    return () => field.removeEventListener('input', sync)
  }, [parts])

  const update = (key) => (event) => {
    const next = { ...parts, [key]: event.target.value }
    if (key === 'hour' && next.hour && !next.minute) next.minute = '00'
    setParts(next)
  }
  // Keep times the store already saved at an odd minute (e.g. :28) selectable until changed.
  const minutes = parts.minute && !MINUTES.includes(parts.minute) ? [...MINUTES, parts.minute].sort() : MINUTES

  return <span className="time-select" role="group" aria-label={label}>
    <select aria-label={`${label} hour`} value={parts.hour} onChange={update('hour')}>
      <option value="">Hour</option>
      {HOURS.map((hour) => <option key={hour} value={hour}>{hour}</option>)}
    </select>
    <span className="time-select-colon" aria-hidden="true">:</span>
    <select aria-label={`${label} minutes`} value={parts.minute} onChange={update('minute')}>
      <option value="">Min</option>
      {minutes.map((minute) => <option key={minute} value={minute}>{minute}</option>)}
    </select>
    <select aria-label={`${label} AM or PM`} value={parts.period} onChange={update('period')}>
      <option value="">AM/PM</option>
      <option value="AM">AM</option>
      <option value="PM">PM</option>
    </select>
    {/* A text field (not type="hidden") so saved drafts include it. */}
    <input ref={valueField} className="time-select-value" type="text" name={name} value={value} readOnly tabIndex={-1} aria-hidden="true" />
  </span>
}
