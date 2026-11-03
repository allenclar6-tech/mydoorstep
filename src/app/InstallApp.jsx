import { useEffect, useState } from 'react'
import { Download, Share, SquarePlus, X } from 'lucide-react'
import { isIos } from '../notifications/push'
import { appKind, canPromptInstall, dismissInstall, installDismissedRecently, isInstalledNow, onInstallChange, promptInstall } from './install'
import './installApp.css'

const COPY = {
  customer: 'Order in one tap from your home screen, with order updates as notifications.',
  business: 'Open your orders board in one tap and hear new orders straight away.',
  rider: 'Go online in one tap and get delivery jobs as notifications.',
  admin: 'Run DOORSTEP from its own app: alerts, to-dos and payouts in one tap.',
}

// "Install the app" card. Android/computers: opens the browser's install dialog. iPhone/iPad: shows the
// Share → Add to Home Screen steps. Hidden once installed, or for two weeks after "Not now".
export function InstallApp({ who = 'customer', always = false }) {
  const [, refresh] = useState(0)
  const [hidden, setHidden] = useState(() => !always && installDismissedRecently())
  const [showSteps, setShowSteps] = useState(false)
  const [note, setNote] = useState('')
  useEffect(() => onInstallChange(() => refresh((value) => value + 1)), [])
  const admin = appKind() === 'admin'
  const name = admin ? 'DOORSTEP Admin' : 'DOORSTEP'
  // Already installed (opened from the home screen or the Android app): show nothing.
  if (isInstalledNow()) return null
  const ios = isIos()
  if (hidden || (!ios && !canPromptInstall())) return always && !ios ? <p className="install-note">To install {name}, open your browser menu and choose “Install app” or “Add to Home screen”.</p> : null

  const install = async () => {
    if (ios) { setShowSteps((value) => !value); return }
    const result = await promptInstall()
    if (result === 'dismissed') setNote('No problem. You can install it any time from your browser menu.')
  }
  return <section className="install-card" aria-label={`Install the ${name} app`}>
    <span className="install-icon" aria-hidden="true"><img src={admin ? '/icons/admin-192.png?v=1' : '/icons/icon-192.png?v=3'} alt="" width="44" height="44" /></span>
    <div>
      <b>Install the {name} app</b>
      <small>{COPY[who] || COPY.customer}</small>
      {showSteps && <ol className="install-steps">
        <li>Tap <Share size={14} aria-label="Share" /> <b>Share</b> at the bottom of Safari.</li>
        <li>Scroll and tap <SquarePlus size={14} aria-hidden="true" /> <b>Add to Home Screen</b>.</li>
        <li>Tap <b>Add</b>. Open {name} from your Home Screen.</li>
      </ol>}
      {note && <small className="install-hint">{note}</small>}
    </div>
    <button type="button" className="install-btn" onClick={install}><Download size={16} aria-hidden="true" /> {ios ? (showSteps ? 'Hide steps' : 'How to install') : 'Install'}</button>
    {!always && <button type="button" className="install-close" onClick={() => { dismissInstall(); setHidden(true) }} aria-label="Not now"><X size={16} /></button>}
  </section>
}
