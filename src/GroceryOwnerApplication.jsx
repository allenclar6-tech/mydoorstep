import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, FileText, Store } from 'lucide-react'
import { PasswordField } from './PasswordField'
import { ApplicationReviewSummary, clearApplicationDraft, getApplicationReview, restoreApplicationDraft, saveApplicationDraft } from './ApplicationReview'
import { applicationSubmissionError, validateOpeningHours } from './applicationValidation'
import { SignInLinks } from './authControls'
import { apiBase } from './config/apiBase'
import { BusinessRegistrationField } from './partner/BusinessRegistrationField'
import { TimeSelect } from './TimeSelect'


const navigate = (path) => {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

const storeWeekDays = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']

function StoreOpeningDaysField() {
  return <fieldset className="opening-days-field"><legend>Opening days</legend><div>{storeWeekDays.map((day) => <label key={day}><input type="checkbox" name="openingDays" value={day} defaultChecked />{day.charAt(0) + day.slice(1).toLowerCase()}</label>)}</div></fieldset>
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
  const [reviewItems, setReviewItems] = useState([])
  const [verified, setVerified] = useState(false)
  const [draftNotice, setDraftNotice] = useState('')
  const formRef = useRef(null)
  const draftKey = 'doorstep-onboarding-grocery'

  useEffect(() => {
    try {
      const draft = formRef.current && restoreApplicationDraft(formRef.current, draftKey)
      if (draft) {
        setStep(Math.max(0, Math.min(draft.step, 2)))
        setDraftNotice('Your saved details were restored. Re-select any documents and verify your email again to continue.')
      }
    } catch {
      setError('We could not restore the saved application from this browser session.')
    }
  }, [])

  const validateStep = (form, currentStep) => {
    const fields = [...form.querySelectorAll(`[data-grocery-step="${currentStep}"] input, [data-grocery-step="${currentStep}"] select`)]
    return fields.every((field) => field.checkValidity() || (field.reportValidity(), false))
  }

  const advance = (event) => {
    const form = event.currentTarget.form
    if (!validateStep(form, step)) return
    if (step === 0 && !validateOpeningHours(form)) return
    setError('')
    setStep((current) => current + 1)
  }

  const saveAndExit = () => {
    try {
      saveApplicationDraft(formRef.current, draftKey, step)
      navigate('/partner/register')
    } catch {
      setError('We could not save this application in the current browser session.')
    }
  }

  const editReviewStep = (reviewStep) => {
    setError('')
    setVerificationId('')
    setChallenge(null)
    setStep(reviewStep)
  }

  const submit = async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    if (!validateStep(form, 4)) return
    if (!validateOpeningHours(form)) return
    if (!verificationId) return setError('Verify the business email before submitting.')
    setBusy(true)
    setError('')
    try {
      const data = new FormData(form)
      const password = form.elements.namedItem('password')
      const confirmPassword = form.elements.namedItem('confirmPassword')
      if (!password.checkValidity() || !confirmPassword.checkValidity()) {
        password.reportValidity()
        confirmPassword.reportValidity()
        return
      }
      if (data.get('password') !== data.get('confirmPassword')) throw new Error('The passwords do not match.')
      data.set('restaurantName', data.get('groceryName'))
      const response = await fetch(`${apiBase}/api/grocery-applications/multipart`, { method: 'POST', body: data })
      const body = await response.json()
      if (!response.ok) throw new Error(applicationSubmissionError(body, form, 'Could not submit your grocery owner application.'))
      clearApplicationDraft(draftKey)
      setSubmitted(true)
    } catch (submissionError) {
      setError(submissionError.message)
    } finally {
      setBusy(false)
    }
  }

  const requestEmailCode = async (event) => {
      const form = event.currentTarget.form
      if (!validateStep(form, 2)) return
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
      const form = event.currentTarget.form
      const code = new FormData(form).get('verificationCode')
      setBusy(true); setError('')
      try {
        const response = await fetch(`${apiBase}/api/auth/verification/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challengeId: challenge?.challengeId, destination: challenge?.destination, code }) })
        const body = await response.json()
        if (!response.ok || !body.verified) throw new Error('The verification code is invalid or expired.')
        setVerificationId(challenge.challengeId)
        setReviewItems(getApplicationReview(form))
        setVerified(true)
        window.setTimeout(() => { setVerified(false); setStep(4) }, 1_200)
      } catch (verificationError) { setError(verificationError.message) } finally { setBusy(false) }
  }

  if (submitted) return <main className="route-page"><div className="route-hero"><span className="section-kicker">GROCERY OWNER APPLICATION</span><h1>Your store is in review.</h1><p>We received your verified application. Your grocery dashboard opens after DOORSTEP approves the store.</p></div><section className="onboarding-card onboarding-success grocery-success"><Check size={27} /><span className="section-kicker">APPLICATION RECEIVED</span><h2>Check your application status.</h2><p>Approval protects customers and lets your store appear in the live grocery marketplace only when it is ready.</p><button className="quiet-button" onClick={() => navigate('/partner/application-status')}>Track application status</button><button className="checkout-button" onClick={() => navigate('/groceries')}>Explore groceries <ArrowRight size={17} /></button></section></main>
  return <main className="route-page"><div className="route-hero grocery-owner-hero"><span className="section-kicker">GROCERY OWNER SETUP</span><h1>Put your store on every doorstep.</h1><p>A short, guided setup for Sapele grocery businesses. Tell us about your store, confirm who manages it, then verify it securely.</p><div className="setup-promises"><span><Check size={15} /> Five simple steps</span><span><Check size={15} /> Optional private documents</span><span><Check size={15} /> No charge to apply</span></div></div><form ref={formRef} noValidate className="application-form onboarding-card grocery-owner-application" onSubmit={submit}><input type="hidden" name="verificationId" value={verificationId} /><StepIndicator step={step} />{verified && <div className="onboarding-success grocery-success verification-success-screen" role="status" aria-live="polite"><div className="verification-success-mark"><Check size={30} /></div><span className="section-kicker">VERIFICATION SUCCESSFUL</span><h2>Your email is ready.</h2></div>}{draftNotice && <p className="onboarding-draft-notice" role="status">{draftNotice}</p>}<p className="onboarding-draft-notice">Save and exit keeps non-secret form details in this browser tab only. Passwords, verification codes, and selected files are never saved.</p>
    <SignInLinks />
    <section hidden={step !== 0} data-grocery-step="0"><span className="section-kicker">STEP 1 OF 5 · STORE SETUP</span><h2>Tell us about your store.</h2><p>Use the name and address customers will recognize. You can refine your catalogue after approval.</p><label>Store name<input required name="groceryName" autoComplete="organization" placeholder="e.g. Amukpe Fresh Market" /></label><label>Store type (optional)<select name="businessType" defaultValue=""><option value="">Prefer not to say</option><option value="supermarket">Supermarket</option><option value="mini_market">Mini market</option><option value="produce_market">Produce market</option><option value="pharmacy">Pharmacy</option><option value="specialty_store">Specialty store</option></select></label><label>Business registration number (optional)<input name="registrationNumber" /></label><label>Store address<input required name="address" autoComplete="street-address" placeholder="Street, area, and closest landmark" /></label><div className="form-row"><label>Opening time<TimeSelect name="openingTime" label="Opening time" /></label><label>Closing time<TimeSelect name="closingTime" label="Closing time" /></label></div><StoreOpeningDaysField /><input name="cityName" type="hidden" value="Sapele" /><p className="setup-tip">Tip: a clear address helps the approval team confirm your service area faster.</p><button className="checkout-button" type="button" onClick={advance}>Continue to owner details <ArrowRight size={17} /></button></section>
    <section hidden={step !== 1} data-grocery-step="1"><span className="section-kicker">STEP 2 OF 5 · OWNER ACCOUNT</span><h2>Who will manage the store?</h2><p>This person will receive approval updates and manage stock, hours, availability, and orders.</p><label>Owner full name<input required name="ownerName" autoComplete="name" /></label><label>Business email<input required name="businessEmail" type="email" autoComplete="email" /></label><label>Business phone<input required name="businessPhone" type="tel" autoComplete="tel" /></label><label>Delivery method<select required name="deliveryPreference" defaultValue="DOORSTEP_RIDERS"><option value="DOORSTEP_RIDERS">DOORSTEP riders</option><option value="OWN_RIDERS">Our own business riders</option><option value="BOTH">Both options</option></select></label>{error && <div className="admin-login-error">{error}</div>}<button className="quiet-button" type="button" onClick={() => setStep(0)}>Back</button><button className="checkout-button" type="button" onClick={advance}>Continue to documents <ArrowRight size={17} /></button></section>
    <section hidden={step !== 2} data-grocery-step="2"><span className="section-kicker">STEP 3 OF 5 · DOCUMENTS</span><h2>Add documents if available.</h2><p>Documents are optional, stored privately, and used only for the DOORSTEP approval review.</p><BusinessRegistrationField /><label>Identity document type (optional)<select name="ownerIdentityType" defaultValue=""><option value="">Prefer not to say</option><option value="NIN">NIN</option><option value="Driver licence">Driver licence</option><option value="International passport">International passport</option><option value="Voter card">Voter card</option></select></label><label>Identity document number (optional)<input name="ownerIdentityNumber" /></label><label className="document-upload"><FileText size={20} /> Add identity and business documents (optional)<input name="documents" type="file" accept=".pdf,.jpg,.jpeg,.png" multiple /></label><small>You may upload up to five clear files now or provide them when requested.</small>{error && <div className="admin-login-error">{error}</div>}<button className="quiet-button" type="button" onClick={() => setStep(1)}>Back</button><button className="checkout-button" disabled={busy} type="button" onClick={requestEmailCode}>{busy ? 'Sending...' : 'Verify business email'} <ArrowRight size={17} /></button></section>
    <section hidden={step !== 3 || verified} data-grocery-step="3"><span className="section-kicker">STEP 4 OF 5 · VERIFY EMAIL</span><h2>Enter your email code.</h2><p>We sent a 6-digit code to <strong>{challenge?.destination}</strong>.</p><label>Verification code<input required name="verificationCode" inputMode="numeric" pattern="[0-9]{6}" maxLength="6" autoComplete="one-time-code" /></label>{error && <div className="admin-login-error">{error}</div>}<button className="quiet-button" type="button" onClick={() => setStep(2)}>Back</button><button className="checkout-button" disabled={busy} type="button" onClick={verifyEmailCode}>{busy ? 'Verifying...' : 'Confirm code'} <ArrowRight size={17} /></button></section>
    <section hidden={step !== 4} data-grocery-step="4"><span className="section-kicker">STEP 5 OF 5 · REVIEW</span><h2>Review your application.</h2><p>Your email is verified. The store remains pending approval until DOORSTEP completes its review.</p><ApplicationReviewSummary items={reviewItems} onEdit={editReviewStep} /><PasswordField required label="Create a secure account password" name="password" minLength="8" autoComplete="new-password" /><PasswordField required label="Confirm account password" name="confirmPassword" minLength="8" autoComplete="new-password" /><label className="terms-check"><input required name="termsAccepted" type="checkbox" /> I confirm these details are accurate and agree to the partner terms and privacy policy.</label>{error && <div className="admin-login-error">{error}</div>}<button className="quiet-button" type="button" onClick={() => setStep(3)}>Back</button><button className="checkout-button" disabled={busy} type="submit">{busy ? 'Submitting...' : 'Send for approval'} <Store size={17} /></button></section>
    <button className="quiet-button onboarding-save-exit" type="button" onClick={saveAndExit}>Save and exit</button>
  </form></main>
}
