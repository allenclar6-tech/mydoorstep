import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, KeyRound, Mail, MessageCircle, ShieldCheck, Smartphone } from 'lucide-react'
import { apiBase } from '../config/apiBase'

const navigate = (path) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')) }
const readToken = () => { try { return localStorage.getItem('doorstep-token') } catch { return null } }
export const PHONE_HANDOFF_KEY = 'doorstep-verified-phone'

const messages = {
  GOOGLE_SIGN_IN_NOT_CONFIGURED: 'Google sign-in is not available yet.',
  GOOGLE_UNAVAILABLE: 'We could not reach Google. Try again in a moment.',
  GOOGLE_TOKEN_INVALID: 'Google sign-in did not complete. Try again.',
  GOOGLE_TOKEN_EXPIRED: 'Your Google sign-in timed out. Try again.',
  GOOGLE_EMAIL_NOT_VERIFIED: 'Your Google account has no verified email address. Sign up with email instead.',
  GOOGLE_CUSTOMERS_ONLY: 'Google sign-in is for customer accounts. Partners, riders and admins sign in with their password.',
  ACCOUNT_EXISTS_SIGN_IN_TO_LINK: 'You already have a DOORSTEP account with this email. Sign in with your password, then connect Google under Account → Sign-in methods.',
  GOOGLE_ALREADY_LINKED: 'That Google account is already connected to a different DOORSTEP account.',
  GOOGLE_ALREADY_CONNECTED: 'A Google account is already connected. Disconnect it first.',
  LAST_SIGN_IN_METHOD: 'Set a password first so you can still get into your account.',
  ACCOUNT_UNAVAILABLE: 'This account is not active. Contact DOORSTEP support.',
  INVALID_PHONE: 'Enter your number in international format, e.g. +2348012345678.',
  INVALID_OR_EXPIRED_CODE: 'That code is wrong or has expired. Request a new one.',
  VERIFICATION_COOLDOWN: 'Please wait a moment before asking for another code.',
  VERIFICATION_HOURLY_LIMIT: 'Too many codes requested for this number. Try again in an hour.',
  SMS_VERIFICATION_NOT_CONFIGURED: 'SMS codes are not available yet.',
  WHATSAPP_VERIFICATION_NOT_CONFIGURED: 'WhatsApp codes are not available yet.',
  SMS_VERIFICATION_UNAVAILABLE: 'We could not send the SMS. Try again, or use another method.',
  WHATSAPP_VERIFICATION_UNAVAILABLE: 'We could not send the WhatsApp message. Make sure this number uses WhatsApp, or choose SMS.',
  PHONE_CUSTOMERS_ONLY: 'Phone-code sign-in is for customer accounts. Partners, riders and admins sign in with their password.',
  AUTH_RATE_LIMITED: 'Too many attempts. Wait a few minutes and try again.',
  TERMS_REQUIRED: 'Accept the DOORSTEP terms to create your account.',
}
export const authMessage = (body, fallback = 'Something went wrong. Try again.') => messages[body?.error] || body?.message || fallback

async function post(path, payload, { auth = false, method = 'POST' } = {}) {
  const token = readToken()
  const response = await fetch(`${apiBase}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(auth && token ? { Authorization: `Bearer ${token}` } : {}) }, body: payload ? JSON.stringify(payload) : undefined })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(authMessage(body)), { body, status: response.status })
  return body
}

function startSession(body, fallback = '/account') {
  localStorage.setItem('doorstep-token', body.token)
  localStorage.setItem('doorstep-role', body.user.role)
  window.dispatchEvent(new Event('storage'))
  const requested = new URLSearchParams(window.location.search).get('return') || ''
  navigate(/^\/(?!\/)[\w\-/?=&.%]*$/.test(requested) ? requested : fallback)
}

/* ---------- which methods the server has switched on ---------- */
let providersPromise = null
export function useAuthProviders() {
  const [providers, setProviders] = useState(null)
  useEffect(() => {
    providersPromise ||= fetch(`${apiBase}/api/auth/providers`).then((response) => response.ok ? response.json() : null).catch(() => null)
    let active = true
    providersPromise.then((value) => { if (active) setProviders(value || { email: true, google: null, phone: { sms: false, whatsapp: false } }) })
    return () => { active = false }
  }, [])
  return providers
}

/* ---------- Google (official Google Identity Services button) ---------- */
let gisPromise = null
function loadGoogleIdentity() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google)
  gisPromise ||= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => resolve(window.google)
    script.onerror = () => { gisPromise = null; reject(new Error('Google sign-in could not load. Check your connection.')) }
    document.head.appendChild(script)
  })
  return gisPromise
}

/** Renders Google's own button. `mode="link"` connects Google to the signed-in account instead of signing in. */
export function GoogleButton({ clientId, mode = 'signin', onDone, onError }) {
  const host = useRef(null)
  const [state, setState] = useState('loading')
  const handlers = useRef({ onDone, onError })
  handlers.current = { onDone, onError }

  useEffect(() => {
    let cancelled = false
    loadGoogleIdentity().then((google) => {
      if (cancelled || !host.current) return
      google.accounts.id.initialize({
        client_id: clientId,
        ux_mode: 'popup',
        auto_select: false,
        cancel_on_tap_outside: true,
        context: mode === 'link' ? 'use' : 'signin',
        callback: async ({ credential }) => {
          setState('working')
          try {
            const body = mode === 'link'
              ? await post('/api/auth/google/link', { credential }, { auth: true })
              : await post('/api/auth/google', { credential, termsAccepted: true })
            setState('ready')
            handlers.current.onDone?.(body)
          } catch (error) { setState('ready'); handlers.current.onError?.(error.message) }
        },
      })
      const width = Math.min(400, Math.max(220, host.current.clientWidth || 320))
      google.accounts.id.renderButton(host.current, { type: 'standard', theme: 'outline', size: 'large', shape: 'pill', text: mode === 'link' ? 'continue_with' : 'continue_with', logo_alignment: 'left', width })
      setState('ready')
    }).catch((error) => { if (!cancelled) { setState('failed'); handlers.current.onError?.(error.message) } })
    return () => { cancelled = true }
  }, [clientId, mode])

  return <div className="alt-google" aria-busy={state !== 'ready'}>
    <div ref={host} className="alt-google-host" />
    {state === 'loading' && <span className="alt-google-placeholder" aria-hidden="true" />}
    {state === 'working' && <small role="status">Signing you in…</small>}
  </div>
}

/* ---------- phone code sign-in ---------- */
function PhoneSignIn({ channels, onCancel }) {
  const [step, setStep] = useState('phone')
  const [phone, setPhone] = useState('')
  const [channel, setChannel] = useState(channels.includes('whatsapp') ? 'whatsapp' : 'sms')
  const [challenge, setChallenge] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [unknownNumber, setUnknownNumber] = useState(null)

  useEffect(() => {
    if (cooldown <= 0) return undefined
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  const send = async (event) => {
    event?.preventDefault()
    setBusy(true); setError('')
    try {
      const body = await post('/api/auth/phone/start', { phone: phone.replace(/\s+/g, ''), channel })
      setChallenge(body); setStep('code'); setCooldown(60)
    } catch (sendError) {
      if (sendError.body?.retryAfterSeconds) setCooldown(sendError.body.retryAfterSeconds)
      setError(sendError.message)
    } finally { setBusy(false) }
  }
  const verify = async (event) => {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const code = new FormData(event.currentTarget).get('code')
      const body = await post('/api/auth/phone/verify', { phone: phone.replace(/\s+/g, ''), challengeId: challenge.challengeId, code })
      if (body.signedIn) return startSession(body)
      sessionStorage.setItem(PHONE_HANDOFF_KEY, JSON.stringify({ phone: body.phone, verificationId: body.verificationId, at: Date.now() }))
      setUnknownNumber(body.phone)
    } catch (verifyError) { setError(verifyError.message) } finally { setBusy(false) }
  }

  if (unknownNumber) return <div className="alt-phone">
    <span className="alt-phone-badge"><Check size={18} aria-hidden="true" /></span>
    <h3>Number confirmed</h3>
    <p>No DOORSTEP account uses <strong>{unknownNumber}</strong> yet. Create one now — your number is already verified.</p>
    <button type="button" className="checkout-button" onClick={() => navigate('/register')}>Create my account <ArrowRight size={17} /></button>
    <button type="button" className="alt-text-button" onClick={onCancel}>Use email instead</button>
  </div>

  if (step === 'code') return <form className="alt-phone" onSubmit={verify}>
    <button type="button" className="alt-back" onClick={() => { setStep('phone'); setError('') }}><ArrowLeft size={16} aria-hidden="true" />Change number</button>
    <h3>Enter the 6-digit code</h3>
    <p>We sent it by {channel === 'whatsapp' ? 'WhatsApp' : 'SMS'} to <strong>{phone}</strong>. It expires in 10 minutes.</p>
    <label>Code<input required name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength="6" autoComplete="one-time-code" autoFocus /></label>
    {error && <div className="admin-login-error" role="alert">{error}</div>}
    <button type="submit" className="checkout-button" disabled={busy}>{busy ? 'Checking…' : 'Sign in'} <ArrowRight size={17} /></button>
    <button type="button" className="alt-text-button" disabled={busy || cooldown > 0} onClick={send}>{cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}</button>
  </form>

  return <form className="alt-phone" onSubmit={send}>
    <h3>Sign in with a code</h3>
    <p>For customers who added and verified their phone number.</p>
    <label>Phone number<input required type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+2348012345678" pattern="\+[1-9][\d ]{7,17}" title="Use international format, for example +2348012345678." /></label>
    {channels.length > 1 && <fieldset className="alt-channel"><legend>Send my code by</legend>
      <label className={channel === 'whatsapp' ? 'is-selected' : ''}><input type="radio" name="channel" checked={channel === 'whatsapp'} onChange={() => setChannel('whatsapp')} /><MessageCircle size={16} aria-hidden="true" />WhatsApp</label>
      <label className={channel === 'sms' ? 'is-selected' : ''}><input type="radio" name="channel" checked={channel === 'sms'} onChange={() => setChannel('sms')} /><Smartphone size={16} aria-hidden="true" />SMS</label>
    </fieldset>}
    {error && <div className="admin-login-error" role="alert">{error}</div>}
    <button type="submit" className="checkout-button" disabled={busy || cooldown > 0}>{busy ? 'Sending…' : cooldown > 0 ? `Wait ${cooldown}s` : `Send code by ${channel === 'whatsapp' ? 'WhatsApp' : 'SMS'}`} <ArrowRight size={17} /></button>
    <button type="button" className="alt-text-button" onClick={onCancel}>Use email and password instead</button>
  </form>
}

/** Extra sign-in options under the customer email/password form. Shows only methods the server has enabled. */
export function AlternativeSignIn({ register = false }) {
  const providers = useAuthProviders()
  const [phoneMode, setPhoneMode] = useState(false)
  const [error, setError] = useState('')
  if (!providers) return null
  const channels = [providers.phone?.whatsapp && 'whatsapp', providers.phone?.sms && 'sms'].filter(Boolean)
  if (!providers.google && !channels.length) return null
  return <div className="alt-signin">
    <div className="alt-divider"><span>or</span></div>
    {phoneMode ? <PhoneSignIn channels={channels} onCancel={() => setPhoneMode(false)} /> : <>
      {providers.google && <GoogleButton clientId={providers.google.clientId} onDone={(body) => startSession(body, body.created ? '/location' : '/account')} onError={setError} />}
      {!register && channels.length > 0 && <button type="button" className="alt-phone-button" onClick={() => setPhoneMode(true)}>
        {channels.includes('whatsapp') ? <MessageCircle size={18} aria-hidden="true" /> : <Smartphone size={18} aria-hidden="true" />}
        Continue with a {channels.includes('whatsapp') ? 'WhatsApp' : 'phone'} code
      </button>}
      {providers.google && <p className="alt-terms">By continuing with Google you agree to the DOORSTEP terms and privacy policy. We only receive your name and email address.</p>}
      {error && <div className="admin-login-error" role="alert">{error}</div>}
    </>}
  </div>
}

/* ---------- verify email / phone while signed in ---------- */
function ContactVerify({ kind, currentPhone, channels, onVerified }) {
  const [phone, setPhone] = useState(currentPhone || '')
  const [channel, setChannel] = useState(channels.includes('whatsapp') ? 'whatsapp' : 'sms')
  const [challenge, setChallenge] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(0)
  useEffect(() => {
    if (cooldown <= 0) return undefined
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])
  const send = async () => {
    setBusy(true); setError('')
    try {
      const body = await post('/api/auth/contact/start', kind === 'email' ? { kind } : { kind, phone: phone.replace(/\s+/g, ''), channel }, { auth: true })
      setChallenge(body); setCooldown(60)
    } catch (sendError) { if (sendError.body?.retryAfterSeconds) setCooldown(sendError.body.retryAfterSeconds); setError(sendError.message) } finally { setBusy(false) }
  }
  const confirm = async (event) => {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const code = new FormData(event.currentTarget).get('code')
      await post('/api/auth/contact/confirm', { kind, phone: kind === 'phone' ? phone.replace(/\s+/g, '') : undefined, challengeId: challenge.challengeId, code }, { auth: true })
      window.dispatchEvent(new Event('doorstep-profile-change'))
      onVerified()
    } catch (confirmError) { setError(confirmError.message) } finally { setBusy(false) }
  }
  if (kind === 'phone' && !channels.length) return <div className="method-verify"><small className="method-hint">Phone codes are not switched on yet.</small></div>
  return <div className="method-verify">
    {!challenge && kind === 'phone' && <div className="method-verify-row">
      <input type="tel" inputMode="tel" aria-label="Phone number" autoComplete="tel" placeholder="+2348012345678" value={phone} onChange={(event) => setPhone(event.target.value)} />
      {channels.length > 1 && <select aria-label="Send code by" value={channel} onChange={(event) => setChannel(event.target.value)}>{channels.map((value) => <option key={value} value={value}>{value === 'whatsapp' ? 'WhatsApp' : 'SMS'}</option>)}</select>}
      <button type="button" className="checkout-button" disabled={busy || cooldown > 0 || !/^\+[1-9][\d ]{7,17}$/.test(phone)} onClick={send}>{busy ? 'Sending…' : 'Send code'}</button>
    </div>}
    {!challenge && kind === 'email' && <div className="method-verify-row"><button type="button" className="checkout-button" disabled={busy || cooldown > 0} onClick={send}>{busy ? 'Sending…' : 'Email me a code'}</button></div>}
    {challenge && <form className="method-verify-row" onSubmit={confirm}>
      <input required name="code" aria-label="6-digit code" inputMode="numeric" pattern="[0-9]{6}" maxLength="6" autoComplete="one-time-code" placeholder="6-digit code" autoFocus />
      <button type="submit" className="checkout-button" disabled={busy}>{busy ? 'Checking…' : 'Confirm'}</button>
      <button type="button" className="alt-text-button" disabled={busy || cooldown > 0} onClick={send}>{cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend'}</button>
    </form>}
    {challenge && <small className="method-hint">Code sent to {kind === 'email' ? 'your email' : phone}. It expires in 10 minutes.</small>}
    {error && <small className="admin-login-error" role="alert">{error}</small>}
  </div>
}

/* ---------- Account → Sign-in methods ---------- */
export function SignInMethodsPage({ backHref = '/account' }) {
  const providers = useAuthProviders()
  const [data, setData] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [verifying, setVerifying] = useState('')
  const role = (() => { try { return localStorage.getItem('doorstep-role') || 'CUSTOMER' } catch { return 'CUSTOMER' } })()
  const customer = role === 'CUSTOMER'
  const load = () => {
    const token = readToken()
    if (!token) return
    fetch(`${apiBase}/api/auth/identities`, { headers: { Authorization: `Bearer ${token}` } }).then((response) => response.ok ? response.json() : Promise.reject(new Error('Could not load your sign-in methods.'))).then(setData).catch((loadError) => setError(loadError.message))
  }
  useEffect(load, [])
  if (!readToken()) return <main className="route-page account-app"><p className="parcel-notice is-info">Sign in to manage how you sign in.</p><button type="button" className="checkout-button" onClick={() => navigate('/login?return=/account/security')}>Sign in</button></main>

  const channels = [providers?.phone?.whatsapp && 'whatsapp', providers?.phone?.sms && 'sms'].filter(Boolean)
  const google = data?.identities.find((identity) => identity.provider === 'google')
  const disconnect = async () => {
    setBusy(true); setError(''); setMessage('')
    try { await post('/api/auth/google/link', null, { auth: true, method: 'DELETE' }); setMessage('Google disconnected.'); load() } catch (unlinkError) { setError(unlinkError.message) } finally { setBusy(false) }
  }
  const verified = (what) => { setVerifying(''); setMessage(what === 'email' ? 'Email verified.' : 'Phone number verified.'); load() }
  const Shell = customer ? 'main' : 'section'
  return <Shell className={`${customer ? 'route-page ' : 'ws-inbox '}account-app sign-in-methods`}>
    <header className="account-subhead">
      <button type="button" className="map-icon-button" aria-label="Back" onClick={() => navigate(backHref)}><ArrowLeft size={18} /></button>
      <h1>Sign-in & security</h1>
    </header>
    {message && <p className="parcel-notice is-info" role="status">{message}</p>}
    {error && <p className="parcel-notice is-error" role="alert">{error}</p>}
    {!data && !error && <p className="parcel-hint" role="status">Loading…</p>}
    {data && <section className="account-app-list method-list" aria-label="Your sign-in methods">
      <div className="method-row"><span className="account-app-icon"><Mail size={19} /></span><span><strong>Email</strong><small>{data.email.address} · {data.email.verified ? 'Verified' : 'Not verified'}</small></span>
        {!data.email.verified && verifying !== 'email' && <button type="button" className="quiet-button" onClick={() => setVerifying('email')}>Verify</button>}
        {verifying === 'email' && <ContactVerify kind="email" channels={channels} onVerified={() => verified('email')} />}
      </div>
      <div className="method-row"><span className="account-app-icon"><KeyRound size={19} /></span><span><strong>Password</strong><small>{data.hasPassword ? 'Set' : 'Not set — you sign in with Google'}</small></span><button type="button" className="quiet-button" onClick={() => navigate('/forgot-password')}>{data.hasPassword ? 'Change' : 'Set password'}</button></div>
      <div className="method-row"><span className="account-app-icon"><Smartphone size={19} /></span><span><strong>Phone</strong><small>{data.phone ? `${data.phone.number} · ${data.phone.verified ? (customer ? 'Verified — you can sign in with a code' : 'Verified') : 'Not verified'}` : 'No phone number on your account'}</small></span>
        {verifying !== 'phone' && (!data.phone?.verified ? <button type="button" className="quiet-button" onClick={() => setVerifying('phone')}>{data.phone ? 'Verify' : 'Add'}</button> : <button type="button" className="quiet-button" onClick={() => setVerifying('phone')}>Change</button>)}
        {verifying === 'phone' && <ContactVerify kind="phone" currentPhone={data.phone?.verified ? '' : data.phone?.number} channels={channels} onVerified={() => verified('phone')} />}
      </div>
      {customer && <div className="method-row is-google"><span className="account-app-icon"><ShieldCheck size={19} /></span><span><strong>Google</strong><small>{google ? `Connected${google.email ? ` · ${google.email}` : ''}` : providers?.google ? 'Not connected' : 'Not available yet'}</small></span>
        {google && <button type="button" className="quiet-button danger" disabled={busy} onClick={disconnect}>{busy ? 'Working…' : 'Disconnect'}</button>}
      </div>}
      {customer && !google && providers?.google && <div className="method-row method-connect"><GoogleButton clientId={providers.google.clientId} mode="link" onDone={() => { setMessage('Google connected. You can now sign in with Google.'); load() }} onError={setError} /></div>}
    </section>}
    {customer && <p className="saved-card-security"><ShieldCheck size={16} aria-hidden="true" />DOORSTEP never sees your Google password. Google only confirms who you are and shares your name and email.</p>}
  </Shell>
}
