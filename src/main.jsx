import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './chatMotion.css'
import './navModern.css'
import './profileModern.css'
import './profileDetails.css'
import './authModern.css'
import './logoCreative.css'
import './visualDepth.css'
import './accountEntry.css'
import './map/mapExperience.css'
import './parcel/parcel.css'
import './polish.css'
import './theme.css'
import './home/mobileHome.css'
import './mobile/mobileApp.css'
import './mobile/authMobile.css'
import './notifications/notifications.css'
import './auth/altSignIn.css'
import './support/helpChat.css'
import './finance/finance.css'
import './orders/orderActions.css'
import './orders/pricing.css'
import './admin/deliveryPricing.css'
import './admin/paymentSettings.css'
import './address/sapeleAddress.css'
import './live/live.css'
import './admin/locationsAdmin.css'
import './payments/bankTransfer.css'
// Catches the browser's install prompt early so the "Install the app" button can use it.
import './app/install'

// Service worker for phone notifications (registered quietly; it never caches pages).
if ('serviceWorker' in navigator) window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined) })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Opening screen (index.html): fade it out once the first page has drawn, after holding it a little on the first
// opening of a session (like Glovo). Later page loads in the same session skip it.
const splash = document.getElementById('ds-splash')
if (splash) {
  const installed = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
  let seen = true
  try { seen = Boolean(sessionStorage.getItem('doorstep-splash-seen')); sessionStorage.setItem('doorstep-splash-seen', '1') } catch { /* private mode */ }
  // First opening in a session: the installed app shows the opening screen for about 2.4 s, a browser tab for about
  // 1.6 s (counted from when the page started loading). After that, pages open straight away.
  const holdMs = seen ? 0 : Math.max(0, (installed ? 2400 : 1600) - performance.now())
  const hide = () => { splash.classList.add('is-done'); setTimeout(() => splash.remove(), 450) }
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(hide, holdMs)))
}
