import { useEffect, useState } from 'react'
import { BellRing, X } from 'lucide-react'
import { dismissedRecently, dismissPrompt, isIos, isStandalone, permission, pushSupported, refreshPushSubscription, turnOnPush } from './push'
import './pushPrompt.css'

// “Turn on notifications” card. Shown to signed-in people whose device hasn’t been asked yet.
// iPhone: notifications only work after “Add to Home Screen”, so it explains that first.
export function PushPrompt({ who = 'customer', admin = false, always = false }) {
  const [state, setState] = useState(() => permission())
  const [hidden, setHidden] = useState(() => !always && dismissedRecently())
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  useEffect(() => { if (state === 'granted') refreshPushSubscription({ admin }) }, [state, admin])
  const iosNeedsInstall = isIos() && !isStandalone()
  if (hidden || state === 'granted' || state === 'denied') return always && state === 'granted' ? <p className="push-on">🔔 Phone notifications are on for this device.</p> : always && state === 'denied' ? <p className="push-note">Notifications are blocked for this site. Allow them in your browser settings, then reload.</p> : null
  if (!pushSupported() && !iosNeedsInstall) return null
  const copy = { customer: 'Know the moment your order is accepted, picked up and at your door.', business: 'Get a loud alert on your phone the second a new order arrives — even when DOORSTEP is closed.', rider: 'Get new delivery jobs on your phone straight away, even with the screen off.', admin: 'Get alerts for bank transfers, withdrawals and orders waiting for a rider.' }[who]
  const turnOn = async () => {
    setBusy(true); setNote('')
    const result = await turnOnPush({ admin })
    setBusy(false)
    if (result === 'on') setState('granted')
    else if (result === 'denied') { setState('denied'); setNote('Notifications were blocked. You can allow them later in your browser settings.') }
    else setNote('Couldn’t turn them on right now. Try again in a minute.')
  }
  return <section className="push-card" aria-label="Turn on notifications">
    <span className="push-icon" aria-hidden="true"><BellRing size={22} /></span>
    <div>
      <b>Turn on notifications</b>
      <small>{iosNeedsInstall ? 'On iPhone: tap the Share button, then “Add to Home Screen”. Open DOORSTEP from your Home Screen and turn notifications on there.' : copy}</small>
      {note && <small className="push-error">{note}</small>}
    </div>
    {!iosNeedsInstall && <button type="button" className="push-btn" disabled={busy} onClick={turnOn}>{busy ? 'Turning on…' : 'Turn on'}</button>}
    {!always && <button type="button" className="push-close" onClick={() => { dismissPrompt(); setHidden(true) }} aria-label="Not now"><X size={16} /></button>}
  </section>
}
