// "Install the app": keeps the browser's install prompt so a DOORSTEP button can show it later.
// Chrome, Edge and Samsung Internet (Android and computers) fire beforeinstallprompt; iPhone/iPad have no prompt,
// so people add the app from Safari's Share menu instead. Imported once, early, from main.jsx.

let deferredPrompt = null
const listeners = new Set()
const notify = () => listeners.forEach((listener) => listener())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault() // show DOORSTEP's own card instead of the browser's mini-bar
    deferredPrompt = event
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    try { localStorage.setItem(`doorstep-installed-${appKind()}`, String(Date.now())) } catch { /* private mode */ }
    notify()
  })
}

/** Which of the two apps this page belongs to. */
export const appKind = () => (typeof window !== 'undefined' && window.location.pathname.startsWith('/admin') ? 'admin' : 'public')

export function isInstalledNow() {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches || window.matchMedia?.('(display-mode: minimal-ui)').matches || window.navigator.standalone === true
}

export const canPromptInstall = () => Boolean(deferredPrompt)

/** Shows the browser's install dialog. Resolves 'accepted', 'dismissed' or 'unavailable'. */
export async function promptInstall() {
  if (!deferredPrompt) return 'unavailable'
  const event = deferredPrompt
  deferredPrompt = null
  notify()
  try {
    await event.prompt()
    const choice = await event.userChoice
    return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed'
  } catch { return 'unavailable' }
}

export function onInstallChange(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const DISMISS_KEY = () => `doorstep-install-dismissed-${appKind()}`
const DISMISS_FOR_MS = 14 * 24 * 60 * 60 * 1000
export function installDismissedRecently() {
  try { return Date.now() - Number(localStorage.getItem(DISMISS_KEY()) || 0) < DISMISS_FOR_MS } catch { return false }
}
export function dismissInstall() {
  try { localStorage.setItem(DISMISS_KEY(), String(Date.now())) } catch { /* private mode */ }
}
