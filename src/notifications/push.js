import { apiBase } from '../config/apiBase'

// Phone/computer notifications: register the service worker and subscribe this device for the signed-in person.
const tokenFor = (admin) => { try { return localStorage.getItem(admin ? 'doorstep-admin-token' : 'doorstep-token') } catch { return null } }
const DISMISS_KEY = 'doorstep-push-dismissed'

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent || '')
export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
export const permission = () => (pushSupported() ? Notification.permission : 'unsupported')
export const dismissedRecently = () => { try { return Date.now() - Number(localStorage.getItem(DISMISS_KEY) || 0) < 7 * 86_400_000 } catch { return false } }
export const dismissPrompt = () => { try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch { /* ignore */ } }

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null
  try { return await navigator.serviceWorker.register('/sw.js', { scope: '/' }) } catch { return null }
}

const urlBase64ToUint8Array = (base64) => {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)))
}

/** Asks permission (must be called from a tap) and saves this device. Returns 'on' | 'denied' | 'unsupported' | 'error'. */
export async function turnOnPush({ admin = false } = {}) {
  if (!pushSupported()) return 'unsupported'
  const token = tokenFor(admin)
  if (!token) return 'error'
  const result = await Notification.requestPermission()
  if (result !== 'granted') return 'denied'
  try {
    const registration = (await registerServiceWorker()) || (await navigator.serviceWorker.ready)
    const keyResponse = await fetch(`${apiBase}/api/push/public-key`)
    if (!keyResponse.ok) return 'error'
    const { publicKey } = await keyResponse.json()
    const existing = await registration.pushManager.getSubscription()
    const subscription = existing || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) })
    const saved = await fetch(`${apiBase}/api/push/subscribe`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: subscription.toJSON() }) })
    return saved.ok ? 'on' : 'error'
  } catch { return 'error' }
}

/** Keeps an already-allowed device linked to whoever is signed in now (e.g. after signing in again). */
export async function refreshPushSubscription({ admin = false } = {}) {
  if (!pushSupported() || Notification.permission !== 'granted' || !tokenFor(admin)) return
  try {
    const registration = await registerServiceWorker()
    const subscription = await registration?.pushManager.getSubscription()
    if (subscription) await fetch(`${apiBase}/api/push/subscribe`, { method: 'POST', headers: { Authorization: `Bearer ${tokenFor(admin)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: subscription.toJSON() }) })
    else await turnOnPush({ admin })
  } catch { /* ignore */ }
}
