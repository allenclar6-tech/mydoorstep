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
    {['Store', 'Owner', 'Documents'].map((label, index) => <li className={index === step ? 'active' : index < step ? 'complete' : ''} key={label}><span>{index < step ? <Check size={13} /> : index + 1}</span><small>{label}</small></li>)}
  </ol>
}

export function GroceryOwnerApplication() {
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)

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
    const documents = form.querySelector('input[name="documents"]')?.files
    if (!documents || documents.length < 2) {
      setError('Upload an identity document and a business registration document.')
      return
    }
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
  }

  if (submitted) return <main className="route-page"><div className="route-hero"><span className="section-kicker">GROCERY OWNER APPLICATION</span><h1>Your store is in review.</h1><p>We received your business and identity documents. Your grocery dashboard opens after DOORSTEP approves the store.</p></div><section className="onboarding-card onboarding-success grocery-success"><Check size={27} /><span className="section-kicker">APPLICATION RECEIVED</span><h2>We will keep you updated.</h2><p>Approval protects customers and lets your store appear in the live grocery marketplace only when it is ready.</p><button className="checkout-button" onClick={() => navigate('/groceries')}>Explore groceries <ArrowRight size={17} /></button></section></main>

  return <main className="route-page"><div className="route-hero grocery-owner-hero"><span className="section-kicker">GROCERY OWNER</span><h1>Put your store on every doorstep.</h1><p>Create a real DOORSTEP grocery store. Once approved, you can manage your live inventory and receive customer orders.</p></div><form className="application-form onboarding-card grocery-owner-application" onSubmit={submit}><StepIndicator step={step} />
    <section hidden={step !== 0} data-grocery-step="0"><span className="section-kicker">STEP 1 OF 3</span><h2>Your grocery store</h2><p>Tell customers and our review team exactly what kind of essentials you provide.</p><label>Store name<input required name="groceryName" autoComplete="organization" placeholder="e.g. Amukpe Fresh Market" /></label><label>Store type<select required name="businessType" defaultValue=""><option value="" disabled>Select store type</option><option value="supermarket">Supermarket</option><option value="mini_market">Mini market</option><option value="produce_market">Produce market</option><option value="pharmacy">Pharmacy</option><option value="specialty_store">Specialty store</option></select></label><label>Business registration number<input required name="registrationNumber" /></label><label>Store address<input required name="address" autoComplete="street-address" /></label><input name="cityName" type="hidden" value="Sapele" /><button className="checkout-button" type="button" onClick={advance}>Continue <ArrowRight size={17} /></button></section>
    <section hidden={step !== 1} data-grocery-step="1"><span className="section-kicker">STEP 2 OF 3</span><h2>Owner and contact details</h2><p>The account owner manages stock, availability, store hours, and orders after approval.</p><label>Owner full name<input required name="ownerName" autoComplete="name" /></label><label>Business email<input required name="businessEmail" type="email" autoComplete="email" /></label><label>Business phone<input required name="businessPhone" type="tel" autoComplete="tel" /></label><PasswordField required label="Account password" name="password" minLength="8" autoComplete="new-password" /><button className="quiet-button" type="button" onClick={() => setStep(0)}>Back</button><button className="checkout-button" type="button" onClick={advance}>Continue <ArrowRight size={17} /></button></section>
    <section hidden={step !== 2} data-grocery-step="2"><span className="section-kicker">STEP 3 OF 3</span><h2>Verify the store</h2><p>These private documents are used only for the DOORSTEP approval review.</p><label>Identity document type<select required name="ownerIdentityType" defaultValue=""><option value="" disabled>Select document type</option><option value="NIN">NIN</option><option value="Driver licence">Driver licence</option><option value="International passport">International passport</option><option value="Voter card">Voter card</option></select></label><label>Identity document number<input required name="ownerIdentityNumber" /></label><label className="document-upload"><FileText size={20} /> Identity and business documents<input required name="documents" type="file" accept="image/*,.pdf" multiple /></label><small>Upload 2 to 5 clear files, including the owner identity and business registration document.</small>{error && <div className="admin-login-error">{error}</div>}<button className="quiet-button" type="button" onClick={() => setStep(1)}>Back</button><button className="checkout-button" disabled={busy} type="submit">{busy ? 'Submitting...' : 'Submit for approval'} <Store size={17} /></button></section>
  </form></main>
}
