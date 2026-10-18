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
    <div>
      <strong>Cookies on DOORSTEP</strong>
      <p>We use essential cookies to keep your account, cart, and delivery choices working. You can accept optional cookies or continue with essential cookies only.</p>
    </div>
    <div className="cookie-consent-actions">
      <button className="quiet-button" type="button" onClick={() => saveConsent('essential')}>Essential only</button>
      <button className="primary-button" type="button" onClick={() => saveConsent('accepted')}>Accept cookies</button>
    </div>
  </aside>
}
