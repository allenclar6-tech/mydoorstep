// Notification sounds, generated with Web Audio (no sound files to download). Browsers only allow sound after
// the person has tapped the page once, so the audio is unlocked on the first tap/keypress and stays ready.
//   chime – customers and admins: short, friendly two-note chime
//   order – businesses: bright three-bell ring for a new order
//   job   – riders: loud, urgent alarm plus a strong vibration (Android; iPhones don't allow web vibration)

const KEY = 'doorstep-sound'
let context = null
let unlocked = false

function audio() {
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext || window.webkitAudioContext
  if (!Ctor) return null
  if (!context) { try { context = new Ctor() } catch { return null } }
  return context
}

export function soundEnabled() { try { return localStorage.getItem(KEY) !== 'off' } catch { return true } }
export function setSoundEnabled(on) { try { localStorage.setItem(KEY, on ? 'on' : 'off') } catch { /* private mode */ } }
export const soundReady = () => unlocked

function unlock() {
  const ctx = audio()
  if (!ctx) return
  const done = () => { unlocked = ctx.state === 'running'; if (unlocked) removeListeners() }
  if (ctx.state === 'suspended') ctx.resume().then(done).catch(() => undefined)
  else done()
  // A silent blip makes iOS Safari treat the context as user-started.
  try { const gain = ctx.createGain(); gain.gain.value = 0; gain.connect(ctx.destination); const osc = ctx.createOscillator(); osc.connect(gain); osc.start(); osc.stop(ctx.currentTime + 0.01) } catch { /* ignore */ }
}
const events = ['pointerdown', 'touchstart', 'keydown']
function removeListeners() { events.forEach((name) => window.removeEventListener(name, unlock, true)) }
if (typeof window !== 'undefined') events.forEach((name) => window.addEventListener(name, unlock, { capture: true, passive: true }))

function tone(ctx, { at, freq, duration, volume, type = 'sine', slideTo }) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, at)
  if (slideTo) osc.frequency.linearRampToValueAtTime(slideTo, at + duration)
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration)
  osc.connect(gain); gain.connect(ctx.destination)
  osc.start(at); osc.stop(at + duration + 0.02)
}

const PATTERNS = {
  chime: (ctx, t) => { tone(ctx, { at: t, freq: 880, duration: 0.22, volume: 0.25 }); tone(ctx, { at: t + 0.16, freq: 1318.5, duration: 0.35, volume: 0.22 }) },
  order: (ctx, t) => { [0, 0.18, 0.36].forEach((offset, index) => tone(ctx, { at: t + offset, freq: [1046.5, 1318.5, 1568][index], duration: 0.3, volume: 0.35, type: 'triangle' })) },
  job: (ctx, t) => {
    // Two loud rising sweeps then three sharp beeps — hard to miss in traffic.
    for (let i = 0; i < 2; i += 1) tone(ctx, { at: t + i * 0.42, freq: 700, slideTo: 1500, duration: 0.36, volume: 0.6, type: 'square' })
    for (let i = 0; i < 3; i += 1) tone(ctx, { at: t + 0.9 + i * 0.16, freq: 1760, duration: 0.11, volume: 0.55, type: 'square' })
  },
}
const VIBRATION = { chime: [120], order: [250, 120, 250], job: [700, 150, 700, 150, 700, 150, 1000] }

/** Plays one alert. Returns false if sound is muted or the browser hasn't allowed it yet (vibration still runs). */
export function playAlert(kind = 'chime') {
  try { navigator.vibrate?.(VIBRATION[kind] || VIBRATION.chime) } catch { /* unsupported */ }
  if (!soundEnabled()) return false
  const ctx = audio()
  if (!ctx) return false
  if (ctx.state === 'suspended') ctx.resume().catch(() => undefined)
  if (ctx.state !== 'running' && !unlocked) return false
  try { (PATTERNS[kind] || PATTERNS.chime)(ctx, ctx.currentTime + 0.02); return true } catch { return false }
}

/** Repeats an alert until stopped (rider job offers). Returns a stop function. */
export function repeatAlert(kind = 'job', everyMs = 3000, maxTimes = 15) {
  let count = 0
  playAlert(kind)
  const timer = window.setInterval(() => {
    count += 1
    if (count >= maxTimes) { window.clearInterval(timer); return }
    playAlert(kind)
  }, everyMs)
  return () => { window.clearInterval(timer); try { navigator.vibrate?.(0) } catch { /* unsupported */ } }
}

/** Which sound fits a notification, from where it leads. */
export function alertKindFor(notification) {
  const link = String(notification?.link || '')
  if (link.startsWith('/rider')) return 'job'
  if (link.startsWith('/restaurant') || link.startsWith('/grocery')) return 'order'
  return 'chime'
}
