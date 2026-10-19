import { useState } from 'react'

const consentCookie = 'doorstep_cookie_consent'
const consentStorage = 'doorstep-cookie-consent'
const maxAgeSeconds = 60 * 60 * 24 * 365

function storedConsent() {
  const cookieValue = document.cookie.split('; ').find((entry) => entry.startsWith(`${consentCookie}=`))?.split('=')[1]
  return cookieValue || localStorage.getItem(consentStorage)
}

export function CookieConsent() {
  const [visible, setVisible] = useState(() => !storedConsent())

  const saveConsent = (choice) => {
    localStorage.setItem(consentStorage, choice)
    const secure = window.location.protocol === 'https:' ? '; Secure' : ''
    document.cookie = `${consentCookie}=${choice}; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax${secure}`
    setVisible(false)
  }

  if (!visible) return null

  return <aside className="cookie-consent" aria-label="Cookie preferences" role="dialog" aria-live="polite">
    <div className="cookie-consent-copy">
      <span className="cookie-consent-kicker">YOUR PRIVACY, YOUR CHOICE</span>
      <strong>Cookies that keep DOORSTEP working smoothly.</strong>
      <p>Essential cookies securely remember your session, cart, delivery area, and preferences. You can allow optional cookies or continue with essential cookies only.</p>
      <ul><li>Secure account and checkout experience</li><li>Saved delivery and cart preferences</li></ul>
    </div>
    <div className="cookie-consent-actions">
      <button className="quiet-button" type="button" onClick={() => saveConsent('essential')}>Essential only</button>
      <button className="primary-button" type="button" onClick={() => saveConsent('accepted')}>Accept cookies</button>
    </div>
  </aside>
}
