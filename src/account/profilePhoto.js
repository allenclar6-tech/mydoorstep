import { useEffect, useSyncExternalStore } from 'react'
import { apiBase } from '../config/apiBase'

// One profile photo for the whole app, tied to the signed-in session. Every avatar (header, account,
// partner and rider screens) reads this, so they always agree, and switching accounts on the same device
// can never show the previous person's picture:
// - the photo is cleared the moment the session token changes, before the new one loads;
// - an answer that arrives after the session changed is thrown away;
// - requests bypass the HTTP cache, because every account shares the /api/profile/photo URL.

const readToken = () => { try { return localStorage.getItem('doorstep-token') } catch { return null } }

let state = { token: undefined, url: null }
let generation = 0
const listeners = new Set()
const emit = () => listeners.forEach((listener) => listener())

function setPhoto(url) {
  if (state.url && state.url !== url) URL.revokeObjectURL(state.url)
  state = { ...state, url }
  emit()
}

async function load() {
  const token = state.token
  const mine = ++generation
  const current = () => mine === generation && state.token === token
  if (!token) { setPhoto(null); return }
  try {
    const headers = { Authorization: `Bearer ${token}` }
    const account = await fetch(`${apiBase}/api/auth/me`, { headers, cache: 'no-store' })
    if (!current()) return
    if (!account.ok) { setPhoto(null); return }
    const { user } = await account.json()
    if (!current()) return
    if (!user?.profileImageKey) { setPhoto(null); return }
    const photo = await fetch(`${apiBase}/api/profile/photo`, { headers, cache: 'no-store' })
    if (!current()) return
    if (!photo.ok) { setPhoto(null); return }
    const blob = await photo.blob()
    if (!current()) return
    setPhoto(URL.createObjectURL(blob))
  } catch {
    // Keep what is shown on a network blip; the next sync or photo change tries again.
  }
}

/** Reloads when the session changed since the last check (sign-in, sign-out, another tab). Cheap to call. */
export function syncProfilePhoto() {
  const token = readToken()
  if (token === state.token) return
  state = { ...state, token }
  setPhoto(null)
  load()
}

/** Forces a reload, e.g. after a new photo was saved. */
export function refreshProfilePhoto() {
  state = { ...state, token: readToken() }
  load()
}

let wired = false
function wire() {
  if (wired || typeof window === 'undefined') return
  wired = true
  window.addEventListener('doorstep-profile-photo-change', refreshProfilePhoto)
  window.addEventListener('storage', (event) => { if (event.key === 'doorstep-token' || event.key === null) syncProfilePhoto() })
  window.addEventListener('popstate', syncProfilePhoto)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncProfilePhoto() })
}

const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener) }
const snapshot = () => state.url

/** The signed-in person's photo as an object URL, or null. */
export function useProfilePhoto() {
  wire()
  const url = useSyncExternalStore(subscribe, snapshot, () => null)
  // Sign-in navigates without a page reload, so check the session whenever an avatar renders.
  useEffect(() => { syncProfilePhoto() })
  return url
}
