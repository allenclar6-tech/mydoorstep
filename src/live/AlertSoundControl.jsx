import { useState } from 'react'
import { Bell, Volume2, VolumeX } from 'lucide-react'
import { playAlert, setSoundEnabled, soundEnabled } from '../notifications/sound'

/**
 * Rider alert settings: test the job alarm (which also unlocks sound in the browser), mute it, and allow phone
 * notifications so alerts still show when the screen is on another app.
 */
export function AlertSoundControl({ kind = 'job' }) {
  const [on, setOn] = useState(soundEnabled())
  const [permission, setPermission] = useState(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
  const [note, setNote] = useState('')
  const test = () => {
    const played = playAlert(kind)
    setNote(played ? 'That’s your job alert. Keep your volume up while you’re online.' : on ? 'Tap “Test alert” once more — your browser needed a tap to allow sound.' : 'Sound is off. Turn it on to hear job alerts.')
  }
  const toggle = () => { const next = !on; setSoundEnabled(next); setOn(next); setNote(next ? 'Job alert sound is on.' : 'Job alert sound is off. You’ll still feel the vibration.') ; if (next) playAlert(kind) }
  const allow = async () => { try { setPermission(await Notification.requestPermission()) } catch { setPermission('denied') } }
  return <section className="as-card" aria-label="Job alert settings">
    <span className="as-icon">{on ? <Volume2 size={18} aria-hidden="true" /> : <VolumeX size={18} aria-hidden="true" />}</span>
    <div className="as-text"><strong>Job alerts {on ? 'with sound' : 'on silent'}</strong><small>New jobs ring loudly and vibrate strongly. Keep this page open and your volume up.</small>{note && <em role="status">{note}</em>}</div>
    <div className="as-actions">
      <button type="button" className="as-btn is-main" onClick={test}>Test alert</button>
      <button type="button" className="as-btn" onClick={toggle}>{on ? 'Mute' : 'Sound on'}</button>
      {permission === 'default' && <button type="button" className="as-btn" onClick={allow}><Bell size={14} aria-hidden="true" />Allow notifications</button>}
    </div>
  </section>
}
