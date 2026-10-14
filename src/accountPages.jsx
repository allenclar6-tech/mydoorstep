import { useState } from 'react'
import { ArrowRight, Check, KeyRound, Mail } from 'lucide-react'
import { PasswordField } from './PasswordField'

const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'
const navigate = (path) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')) }
const recoveryMessage = (error) => ({
  EMAIL_VERIFICATION_NOT_CONFIGURED: 'Password recovery email is not configured. Please contact support.',
  EMAIL_VERIFICATION_RATE_LIMITED: 'Too many email requests. Please wait a few minutes before trying again.',
  VERIFICATION_SERVICE_UNAVAILABLE: 'The email service is temporarily unavailable. Please try again shortly.',
  AUTH_RATE_LIMITED: 'Too many attempts. Please wait a few minutes before trying again.',
}[error] || error || 'Unable to complete password recovery. Please try again.')

export function ForgotPasswordPage({ loginPath = '/login' }) {
  const [email, setEmail] = useState('')
  const [challenge, setChallenge] = useState(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch(`${apiBase}/api/auth/forgot-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }), signal: AbortSignal.timeout(20_000) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error)
      setChallenge(body)
      setMessage('If the account exists, a reset code has been sent to its email address.')
    } catch (error) {
      setMessage(error.name === 'TimeoutError' ? 'The recovery service did not respond. Please try again.' : recoveryMessage(error.message))
    } finally {
      setBusy(false)
    }
  }
  const resetPassword = async (event) => {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    const values = Object.fromEntries(new FormData(event.currentTarget).entries())
    try {
      const response = await fetch(`${apiBase}/api/auth/reset-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, challengeId: challenge.challengeId, code: values.code, password: values.password }), signal: AbortSignal.timeout(20_000) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error)
      setMessage('Password reset successfully. Returning you to sign in...')
      window.setTimeout(() => navigate(loginPath), 700)
    } catch (error) {
      setMessage(error.name === 'TimeoutError' ? 'The recovery service did not respond. Please try again.' : recoveryMessage(error.message))
    } finally {
      setBusy(false)
    }
  }
  return <main className="account-recovery-page"><section className="recovery-card"><div className="recovery-icon"><KeyRound size={24} /></div><span className="section-kicker">ACCOUNT RECOVERY</span><h1>Reset your password.</h1><p>Enter the email on your DOORSTEP account and we’ll send a short-lived verification code.</p>{!challenge ? <form onSubmit={submit}><label>Email address<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>{message && <div className="profile-message">{message}</div>}<button className="checkout-button" disabled={busy} type="submit">{busy ? 'Sending...' : 'Send reset code'} <Mail size={17} /></button></form> : <form onSubmit={resetPassword}><label>6-digit reset code<input required name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength="6" /></label><PasswordField required label="New password" name="password" minLength="8" autoComplete="new-password" />{message && <div className="profile-message">{message}</div>}<button className="checkout-button" disabled={busy} type="submit">{busy ? 'Resetting...' : 'Reset password'} <Check size={17} /></button></form>}<button className="recovery-back" onClick={() => navigate(loginPath)}><ArrowRight size={15} /> Back to login</button></section></main>
}
