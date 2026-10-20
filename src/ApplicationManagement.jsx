import { useEffect, useState } from 'react'
import { Check, FileText } from 'lucide-react'
import { apiBase } from './config/apiBase'
import { BUSINESS_STATUS, VerificationPanel } from './admin/VerificationPanel'


function AdminIntro({ eyebrow, title }) {
  return <div className="admin-intro"><div><span className="section-kicker">{eyebrow}</span><h2>{title}</h2></div></div>
}

export function ApplicationManagement({ kind, type }) {
  const isBusiness = type !== 'rider'
  const businessLabel = type === 'grocery' ? 'Grocery store' : 'Food business'
  const token = localStorage.getItem('doorstep-admin-token')
  const [items, setItems] = useState([])
  const [message, setMessage] = useState('')
  const [filters, setFilters] = useState({ search: '', city: '', from: '', to: '', status: 'OPEN' })
  const [notes, setNotes] = useState({})
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value))
      try {
        const response = await fetch(`${apiBase}/api/admin/applications/${type}?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        })
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || 'Could not load the approval queue.')
        setItems(body.applications || [])
      } catch (error) {
        if (error.name !== 'AbortError') setMessage(error.message || 'Could not load the approval queue.')
      }
    }
    load()
    return () => controller.abort()
  }, [filters, revision, token, type])

  const updateFilter = (name, value) => {
    setMessage('')
    setFilters((current) => ({ ...current, [name]: value }))
  }

  const review = async (applicationId, status) => {
    const note = notes[applicationId]?.trim() || undefined
    if (['NEEDS_INFORMATION', 'REJECTED'].includes(status) && !note) {
      setMessage('Add a review note before requesting information or rejecting an application.')
      return
    }
    setMessage('')
    try {
      const response = await fetch(`${apiBase}/api/admin/applications/${type}/${applicationId}/review`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, note }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.message || body.error || 'Could not update application.')
      setMessage(`Application updated: ${status.replaceAll('_', ' ').toLowerCase()}.`)
      setRevision((current) => current + 1)
    } catch (error) {
      setMessage(error.message || 'Could not update application.')
    }
  }

  const downloadDocument = async (application, file) => {
    setMessage('')
    try {
      const response = await fetch(`${apiBase}/api/admin/applications/${type}/${application.id}/documents/${file.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) {
        const body = await response.json()
        throw new Error(body.error || 'Could not open this private document.')
      }
      const fileUrl = URL.createObjectURL(await response.blob())
      const link = globalThis.document.createElement('a')
      link.href = fileUrl
      link.download = `${file.type.toLowerCase()}-${file.id}`
      link.rel = 'noopener'
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(fileUrl), 60_000)
    } catch (error) {
      setMessage(error.message || 'Could not open this private document.')
    }
  }

  const nameFor = (application) => isBusiness
    ? application.restaurant?.name || application.ownerName
    : `${application.rider?.user?.firstName || ''} ${application.rider?.user?.lastName || ''}`.trim() || 'Rider application'

  return <>
    <AdminIntro eyebrow={`MANAGE ${kind.toUpperCase()}`} title={`${kind} application review.`} />
    <section className="admin-table">
      <div className="admin-table-head application-filter-grid">
        <input aria-label={`Search ${kind.toLowerCase()} applicants`} value={filters.search} onChange={(event) => updateFilter('search', event.target.value)} placeholder={`Search ${kind.toLowerCase()}...`} />
        <input aria-label="Filter by service area" value={filters.city} onChange={(event) => updateFilter('city', event.target.value)} placeholder="Service area" />
        <label>From<input type="date" value={filters.from} onChange={(event) => updateFilter('from', event.target.value)} /></label>
        <label>To<input type="date" value={filters.to} onChange={(event) => updateFilter('to', event.target.value)} /></label>
        <select aria-label="Filter by application status" value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}>
          <option value="OPEN">Needs review</option><option value="PENDING_APPROVAL">Pending review</option><option value="NEEDS_INFORMATION">Needs information</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option><option value="SUSPENDED">Suspended</option>
        </select>
      </div>
      {message && <div className="admin-login-error" role="status">{message}</div>}
      {items.length === 0 && !message ? <div className="empty-state">No matching {kind.toLowerCase()} applications.</div> : items.map((application) => {
        const name = nameFor(application)
        const applicant = application.rider?.user
        const business = application.restaurant
        const documents = application.documents || application.identityDocuments || []
        return <article className="admin-application-card" key={application.id}>
          <div className="admin-application-heading">
            <div className="admin-person"><span>{name.charAt(0)}</span><div><strong>{name}</strong><small>{isBusiness ? `${businessLabel} · ${business?.city?.name || 'Service area pending'}` : `Rider · ${application.preferredArea || 'Service area not provided'}`}</small></div></div>
            <span className="admin-pill-group">{isBusiness && <span className={`admin-pill ${(BUSINESS_STATUS[application.businessVerificationStatus] || BUSINESS_STATUS.NOT_SUBMITTED)[1]}`}>{(BUSINESS_STATUS[application.businessVerificationStatus] || BUSINESS_STATUS.NOT_SUBMITTED)[0]}</span>}<span className={`admin-pill ${application.status === 'NEEDS_INFORMATION' ? 'pending' : 'active'}`}>{application.status.replaceAll('_', ' ')}</span></span>
          </div>
          <dl className="admin-application-details">
            <div><dt>Applicant</dt><dd>{isBusiness ? application.ownerName : name}</dd></div>
            <div><dt>Email</dt><dd>{isBusiness ? application.ownerEmail : applicant?.email}</dd></div>
            <div><dt>Phone</dt><dd>{isBusiness ? application.ownerPhone : applicant?.phone}</dd></div>
            {isBusiness && <div><dt>Address</dt><dd>{business?.address}</dd></div>}
            {isBusiness && application.businessCategory && <div><dt>Business type</dt><dd>{application.businessCategory.replaceAll('_', ' ')}</dd></div>}
            {isBusiness && application.registrationNumber && <div><dt>Registration</dt><dd>{application.registrationNumber}</dd></div>}
            {isBusiness && application.whatsApp && <div><dt>WhatsApp</dt><dd>{application.whatsApp}</dd></div>}
            {isBusiness && application.deliveryPreference && <div><dt>Delivery</dt><dd>{application.deliveryPreference.replaceAll('_', ' ').toLowerCase()}</dd></div>}
            {!isBusiness && <><div><dt>Vehicle</dt><dd>{application.rider?.vehicleType || 'Not provided'} · {application.vehicleOwnership === 'OWNED' ? 'Owned' : application.vehicleOwnership === 'PERMITTED' ? 'Permission confirmed' : 'Access not confirmed'}</dd></div><div><dt>Availability</dt><dd>{application.typicalAvailability || 'Not provided'}</dd></div></>}
            <div><dt>Submitted</dt><dd>{new Date(application.submittedAt).toLocaleString('en-NG')}</dd></div>
          </dl>
          <div className="admin-application-documents"><strong>Private documents</strong>{documents.length ? documents.map((document) => <button type="button" key={document.id} onClick={() => downloadDocument(application, document)}><FileText size={14} /> {document.type.replaceAll('_', ' ').toLowerCase()}</button>) : <small>No files supplied</small>}</div>
          <VerificationPanel type={type} application={application} token={token} onChanged={() => setRevision((current) => current + 1)} />
          <label className="admin-review-note">Review note<textarea value={notes[application.id] || ''} onChange={(event) => setNotes((current) => ({ ...current, [application.id]: event.target.value }))} maxLength="1000" rows="2" placeholder="Explain missing information or the reason for rejection." /></label>
          <div className="admin-application-actions">
            <button className="row-more" onClick={() => review(application.id, 'NEEDS_INFORMATION')}>Request information</button>
            <button className="admin-review" onClick={() => review(application.id, 'REJECTED')}>Reject</button>
            <button className="admin-primary" onClick={() => review(application.id, 'APPROVED')}><Check size={14} /> Approve</button>
          </div>
        </article>
      })}
    </section>
  </>
}
