import { useState } from 'react'
import { ArrowRight, Check, FileText, Store } from 'lucide-react'
import { PasswordField } from './PasswordField'

const apiBase = globalThis.location?.hostname === 'mydoorstep.com.co' ? '' : import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

const navigate = (path) => {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function StepIndicator({ step }) {
  return <ol className="onboarding-progress grocery-onboarding-progress" aria-label="Grocery owner application progress">
    {['Store', 'Owner', 'Documents', 'Verify email', 'Review'].map((label, index) => <li className={index === step ? 'active' : index < step ? 'complete' : ''} key={label}><span>{index < step ? <Check size={13} /> : index + 1}</span><small>{label}</small></li>)}
  </ol>
}

export function GroceryOwnerApplication() {
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [challenge, setChallenge] = useState(null)
  const [verificationId, setVerificationId] = useState('')

  const advance = (event) => {
    const form = event.currentTarget.form
    const fields = [...form.querySelectorAll(`[data-grocery-step="${step}"] input, [data-grocery-step="${step}"] select`)]
    if (!fields.every((field) => field.checkValidity() || (field.reportValidity(), false))) return
    setError('')
    setStep((current) => current + 1)
  }

  const submit = async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    if (!verificationId) return setError('Verify the business email before submitting.')
    setBusy(true)
    setError('')
    try {
      const data = new FormData(form)
      data.set('restaurantName', data.get('groceryName'))
      const response = await fetch(`${apiBase}/api/grocery-applications/multipart`, { method: 'POST', body: data })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not submit your grocery owner application.')
      setSubmitted(true)
    } catch (submissionError) {
      setError(submissionError.message)
    } finally {
      setBusy(false)
    }
    const requestEmailCode = async (event) => {
      const form = event.currentTarget.form
      if (!validateOnboardingStep(form, 2)) return
      const destination = new FormData(form).get('businessEmail')
      setBusy(true); setError('')
      try {
        const response = await fetch(`${apiBase}/api/auth/verification/request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ destination, channel: 'email' }) })
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || 'Could not send the verification code.')
        setChallenge({ ...body, destination }); setStep(3)
      } catch (requestError) { setError(requestError.message) } finally { setBusy(false) }
    }
    const verifyEmailCode = async (event) => {
      const code = new FormData(event.currentTarget.form).get('verificationCode')
      setBusy(true); setError('')
      try {
        const response = await fetch(`${apiBase}/api/auth/verification/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challengeId: challenge?.challengeId, destination: challenge?.destination, code }) })
        const body = await response.json()
        if (!response.ok || !body.verified) throw new Error('The verification code is invalid or expired.')
        setVerificationId(challenge.challengeId); setStep(4)
      } catch (verificationError) { setError(verificationError.message) } finally { setBusy(false) }
    }
  }

  if (submitted) return <main className="route-page"><div className="route-hero"><span className="section-kicker">GROCERY OWNER APPLICATION</span><h1>Your store is in review.</h1><p>We received your verified application. Your grocery dashboard opens after DOORSTEP approves the store.</p></div><section className="onboarding-card onboarding-success grocery-success"><Check size={27} /><span className="section-kicker">APPLICATION RECEIVED</span><h2>We will keep you updated.</h2><p>Approval protects customers and lets your store appear in the live grocery marketplace only when it is ready.</p><button className="checkout-button" onClick={() => navigate('/groceries')}>Explore groceries <ArrowRight size={17} /></button></section></main>

  return <main className="route-page"><div className="route-hero grocery-owner-hero"><span className="section-kicker">GROCERY OWNER SETUP</span><h1>Put your store on every doorstep.</h1><p>A short, guided setup for Sapele grocery businesses. Tell us about your store, confirm who manages it, then verify it securely.</p><div className="setup-promises"><span><Check size={15} /> Five simple steps</span><span><Check size={15} /> Optional private documents</span><span><Check size={15} /> No charge to apply</span></div></div><form className="application-form onboarding-card grocery-owner-application" onSubmit={submit}><input type="hidden" name="verificationId" value={verificationId} /><StepIndicator step={step} />
    <section hidden={step !== 0} data-grocery-step="0"><span className="section-kicker">STEP 1 OF 5 · STORE SETUP</span><h2>Tell us about your store.</h2><p>Use the name and address customers will recognize. You can refine your catalogue after approval.</p><label>Store name<input required name="groceryName" autoComplete="organization" placeholder="e.g. Amukpe Fresh Market" /></label><label>Store type (optional)<select name="businessType" defaultValue=""><option value="">Prefer not to say</option><option value="supermarket">Supermarket</option><option value="mini_market">Mini market</option><option value="produce_market">Produce market</option><option value="pharmacy">Pharmacy</option><option value="specialty_store">Specialty store</option></select></label><label>Business registration number (optional)<input name="registrationNumber" /></label><label>Store address<input required name="address" autoComplete="street-address" placeholder="Street, area, and closest landmark" /></label><input name="cityName" type="hidden" value="Sapele" /><p className="setup-tip">Tip: a clear address helps the approval team confirm your service area faster.</p><button className="checkout-button" type="button" onClick={advance}>Continue to owner details <ArrowRight size={17} /></button></section>
    <section hidden={step !== 1} data-grocery-step="1"><span className="section-kicker">STEP 2 OF 5 · OWNER ACCOUNT</span><h2>Who will manage the store?</h2><p>This person will receive approval updates and manage stock, hours, availability, and orders.</p><label>Owner full name<input required name="ownerName" autoComplete="name" /></label><label>Business email<input required name="businessEmail" type="email" autoComplete="email" /></label><label>Business phone<input required name="businessPhone" type="tel" autoComplete="tel" /></label><PasswordField required label="Create a secure account password" name="password" minLength="8" autoComplete="new-password" /><button className="quiet-button" type="button" onClick={() => setStep(0)}>Back</button><button className="checkout-button" type="button" onClick={advance}>Continue to documents <ArrowRight size={17} /></button></section>
    <section hidden={step !== 2} data-grocery-step="2"><span className="section-kicker">STEP 3 OF 5 · DOCUMENTS</span><h2>Add documents if available.</h2><p>Documents are optional, stored privately, and used only for the DOORSTEP approval review.</p><label>Identity document type (optional)<select name="ownerIdentityType" defaultValue=""><option value="">Prefer not to say</option><option value="NIN">NIN</option><option value="Driver licence">Driver licence</option><option value="International passport">International passport</option><option value="Voter card">Voter card</option></select></label><label>Identity document number (optional)<input name="ownerIdentityNumber" /></label><label className="document-upload"><FileText size={20} /> Add identity and business documents (optional)<input name="documents" type="file" accept="image/*,.pdf" multiple /></label><small>You may upload up to five clear files now or provide them when requested.</small>{error && <div className="admin-login-error">{error}</div>}<button className="quiet-button" type="button" onClick={() => setStep(1)}>Back</button><button className="checkout-button" disabled={busy} type="button" onClick={requestEmailCode}>{busy ? 'Sending...' : 'Verify business email'} <ArrowRight size={17} /></button></section>
    <section hidden={step !== 3} data-grocery-step="3"><span className="section-kicker">STEP 4 OF 5 · VERIFY EMAIL</span><h2>Enter your email code.</h2><p>We sent a 6-digit code to <strong>{challenge?.destination}</strong>.</p><label>Verification code<input required name="verificationCode" inputMode="numeric" pattern="[0-9]{6}" maxLength="6" autoComplete="one-time-code" /></label>{error && <div className="admin-login-error">{error}</div>}<button className="quiet-button" type="button" onClick={() => setStep(2)}>Back</button><button className="checkout-button" disabled={busy} type="button" onClick={verifyEmailCode}>{busy ? 'Verifying...' : 'Confirm code'} <ArrowRight size={17} /></button></section>
    <section hidden={step !== 4} data-grocery-step="4"><span className="section-kicker">STEP 5 OF 5 · REVIEW</span><h2>Ready to send for approval.</h2><p>Your email is verified. The store remains pending approval until DOORSTEP completes its review.</p>{error && <div className="admin-login-error">{error}</div>}<button className="quiet-button" type="button" onClick={() => setStep(3)}>Back</button><button className="checkout-button" disabled={busy} type="submit">{busy ? 'Submitting...' : 'Send for approval'} <Store size={17} /></button></section>
  </form></main>
}
