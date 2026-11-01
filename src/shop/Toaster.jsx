import { useEffect, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'

// Small confirmation bubble ("Added to basket") shown at the bottom of the screen.
const EVENT = 'doorstep-toast'
export function toast(message) { window.dispatchEvent(new CustomEvent(EVENT, { detail: message })) }

export function Toaster() {
  const [message, setMessage] = useState(null)
  useEffect(() => {
    let timer
    const show = (event) => { setMessage({ text: event.detail, key: Date.now() }); window.clearTimeout(timer); timer = window.setTimeout(() => setMessage(null), 2200) }
    window.addEventListener(EVENT, show)
    return () => { window.removeEventListener(EVENT, show); window.clearTimeout(timer) }
  }, [])
  return <div className="sp-toast-zone" role="status" aria-live="polite">{message && <div key={message.key} className="sp-toast"><CheckCircle2 size={18} aria-hidden="true" />{message.text}</div>}</div>
}
