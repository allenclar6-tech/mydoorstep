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

export const PUSH_CHANGE_EVENT = 'doorstep-push-change'
const announce = () => { try { window.dispatchEvent(new Event(PUSH_CHANGE_EVENT)) } catch { /* ignore */ } }

/** Rejects if a step takes too long, so the button can never stay on “Turning on…” forever. */
const withTimeout = (promise, ms, what) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} took too long`)), ms))])

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null
  try { return await navigator.serviceWorker.register('/sw.js', { scope: '/' }) } catch { return null }
}

/** A service worker that is fully running (subscribing needs an active one). */
async function activeRegistration() {
  const registration = await registerServiceWorker()
  if (!registration) throw new Error('The notification helper (sw.js) could not start')
  if (registration.active) return registration
  return withTimeout(navigator.serviceWorker.ready, 15_000, 'Starting the notification helper')
}

/** Fetch that gives up after `ms` and tries once more (the server can be slow to wake up). */
async function patientFetch(url, options = {}, ms = 25_000) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ms)
    try { return await fetch(url, { ...options, signal: controller.signal }) }
    catch (error) { if (attempt === 1) throw error }
    finally { clearTimeout(timer) }
  }
  throw new Error('Network error')
}

const urlBase64ToUint8Array = (base64) => {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)))
}

/**
 * Asks permission (must be called from a tap) and saves this device.
 * onStep('asking' | 'saving') lets the button say what is happening.
 * Returns 'on' | 'denied' | 'dismissed' | 'unsupported' | 'signin' | 'error'.
 */
export async function turnOnPush({ admin = false, onStep } = {}) {
  if (!pushSupported()) return 'unsupported'
  const token = tokenFor(admin)
  if (!token) return 'signin'
  let result = Notification.permission
  if (result !== 'granted') {
    onStep?.('asking')
    result = await Notification.requestPermission()
    announce()
    if (result === 'denied') return 'denied'
    if (result !== 'granted') return 'dismissed'
  }
  onStep?.('saving')
  // Each step names itself, so a failure says exactly where it stopped.
  let stage = 'helper'
  try {
    const registration = await activeRegistration()
    stage = 'key'
    const keyResponse = await patientFetch(`${apiBase}/api/push/public-key`)
    if (!keyResponse.ok) throw new Error(`Key request failed (${keyResponse.status})`)
    const { publicKey } = await keyResponse.json()
    const key = urlBase64ToUint8Array(publicKey)
    stage = 'subscribe'
    let subscription = await registration.pushManager.getSubscription()
    // A subscription made with an older key can’t be used; replace it.
    const oldKey = subscription?.options?.applicationServerKey
    if (subscription && oldKey && new Uint8Array(oldKey).join() !== key.join()) { await subscription.unsubscribe().catch(() => undefined); subscription = null }
    if (!subscription) subscription = await withTimeout(registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }), 20_000, 'Subscribing this device')
    stage = 'save'
    const saved = await patientFetch(`${apiBase}/api/push/subscribe`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: subscription.toJSON() }) })
    if (saved.status === 401) { stage = 'signin'; throw new Error('Signed out') }
    if (!saved.ok) throw new Error(`Saving failed (${saved.status})`)
    announce()
    return 'on'
  } catch (error) {
    console.warn(`[DOORSTEP push] stopped at "${stage}":`, error?.name, error?.message || error)
    announce()
    return stage === 'signin' ? 'signin' : `error:${stage}`
  }
}

/** Plain-English help for a failed step. */
export function pushErrorHelp(result) {
  const stage = String(result || '').split(':')[1]
  const windows = /windows/i.test(navigator.userAgent || '')
  const edge = /edg\//i.test(navigator.userAgent || '')
  if (stage === 'subscribe') return windows
    ? `Your browser’s notification service said no. On Windows: open Settings → System → Notifications, make sure Notifications are on and ${edge ? 'Microsoft Edge' : 'your browser'} is switched on, then tap “Try again”.`
    : 'Your browser’s notification service said no. Check notifications are allowed for this browser in your device settings, then tap “Try again”.'
  if (stage === 'helper') return 'The browser couldn’t start DOORSTEP’s notification helper. Reload the page, then tap “Try again”.'
  if (stage === 'key' || stage === 'save') return 'DOORSTEP’s server didn’t answer in time. Check your internet, then tap “Try again”.'
  return 'Couldn’t finish turning them on. Reload the page, then tap “Try again”.'
}

/** Calls back whenever notification permission changes (prompt answered, or changed in browser settings). */
export function watchPermission(callback) {
  const run = () => callback(permission())
  window.addEventListener(PUSH_CHANGE_EVENT, run)
  let status = null
  navigator.permissions?.query({ name: 'notifications' }).then((result) => { status = result; status.onchange = run }).catch(() => undefined)
  return () => { window.removeEventListener(PUSH_CHANGE_EVENT, run); if (status) status.onchange = null }
}

/** Keeps an already-allowed device linked to whoever is signed in now (e.g. after signing in again). */
export async function refreshPushSubscription({ admin = false } = {}) {
  if (!pushSupported() || Notification.permission !== 'granted' || !tokenFor(admin)) return
  try {
    const registration = await activeRegistration()
    const subscription = await registration.pushManager.getSubscription()
    if (subscription) await fetch(`${apiBase}/api/push/subscribe`, { method: 'POST', headers: { Authorization: `Bearer ${tokenFor(admin)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: subscription.toJSON() }) })
    else await turnOnPush({ admin })
  } catch { /* ignore */ }
}
