import { useEffect, useRef, useState } from 'react'
import { Camera, Check, ImagePlus, X } from 'lucide-react'
import './partnerMedia.css'
import { apiBase } from './config/apiBase'

export const partnerApiBase = apiBase
export const mediaSource = source => source?.startsWith('/api/') ? `${partnerApiBase}${source}` : source

export function validatePartnerImage(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return 'Choose a JPEG, PNG or WebP image.'
  if (!file.size || file.size > 5 * 1024 * 1024) return 'Choose an image smaller than 5 MB.'
  return ''
}

export function PartnerImageUpload({ label, endpoint, imageEndpoint, initialImage, onSaved, logo = false, profile = false }) {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [savedImage, setSavedImage] = useState(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const input = useRef(null)
  useEffect(() => {
    if (!file) { setPreview(null); return }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  useEffect(() => {
    if (!imageEndpoint) return
    const controller = new AbortController()
    let url
    fetch(`${partnerApiBase}${imageEndpoint}`, { headers: { Authorization: `Bearer ${localStorage.getItem('doorstep-token')}` }, signal: controller.signal })
      .then(async response => {
        if (response.status === 404) return
        if (!response.ok) throw new Error('Could not load your saved image.')
        const blob = await response.blob()
        if (controller.signal.aborted) return
        url = URL.createObjectURL(blob); setSavedImage(url)
      }).catch(error => { if (error.name !== 'AbortError') setError('Could not load your saved image. Check your connection and try again.') })
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url) }
  }, [imageEndpoint, revision])
  const choose = event => {
    const selected = event.target.files?.[0]
    setMessage(''); setError('')
    if (!selected) return
    const invalid = validatePartnerImage(selected)
    if (invalid) { setError(invalid); event.target.value = ''; return }
    setFile(selected)
  }
  const save = async () => {
    if (!file || busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      const token = localStorage.getItem('doorstep-token')
      let response
      if (profile) {
        const upload = new FormData()
        upload.append('document', file)
        const uploadResponse = await fetch(`${partnerApiBase}/api/uploads/private-document`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: upload, signal: AbortSignal.timeout(30_000) })
        const uploaded = await uploadResponse.json()
        if (!uploadResponse.ok) throw new Error(uploaded.error === 'IMAGE_TOO_LARGE' ? 'Choose an image smaller than 5 MB.' : uploaded.error === 'UNSUPPORTED_DOCUMENT_TYPE' ? 'Choose a JPEG, PNG or WebP image.' : 'Could not securely upload your image. Please try again.')
        response = await fetch(`${partnerApiBase}${endpoint}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ storageKey: uploaded.storageKey }), signal: AbortSignal.timeout(30_000) })
      } else {
        const body = new FormData()
        body.append('image', file)
        response = await fetch(`${partnerApiBase}${endpoint}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body, signal: AbortSignal.timeout(30_000) })
      }
      const result = await response.json()
      if (!response.ok) {
        const errors = { IMAGE_TOO_LARGE: 'Choose an image smaller than 5 MB.', INVALID_IMAGE: 'This image could not be read. Try another image up to 25 megapixels.', UNSUPPORTED_IMAGE_TYPE: 'Choose a JPEG, PNG or WebP image.', MENU_ITEM_NOT_FOUND: 'This menu item no longer exists. Refresh your menu.', RESTAURANT_ACCESS_REQUIRED: 'Your account is not linked to this business.' }
        throw new Error(errors[result.error] || 'Could not save your image. Please try again.')
      }
      if (!result.saved && !result.imageUrl && !result.user) throw new Error('The server did not confirm your upload. Please refresh and check.')
      setFile(null); if (input.current) input.current.value = ''
      setRevision(value => value + 1)
      setMessage(`${label} saved.`)
      if (logo || profile) window.dispatchEvent(new Event('doorstep-profile-photo-change'))
      onSaved?.(result)
    } catch (error) { setError(error.name === 'TimeoutError' ? 'Upload timed out. Check your connection and try again.' : error.message) } finally { setBusy(false) }
  }
  const source = preview || savedImage || mediaSource(initialImage)
  return <section className={`partner-media-card${logo ? ' partner-logo-upload' : ''}`} aria-label={`${label} upload`}>
    <div className="partner-media-preview">{source ? <img src={source} alt={`${label}${preview ? ' preview' : ''}`} /> : <ImagePlus size={42} aria-hidden="true" />}{preview && <span>PREVIEW · NOT SAVED</span>}</div>
    <div className="partner-media-controls"><strong>{label}</strong><p>{logo ? 'Use your business logo as your partner profile picture.' : profile ? 'Use a clear photo so DOORSTEP operations can identify you.' : 'Show customers a clear, accurate photo of this item.'} JPEG, PNG or WebP, up to 5 MB.</p><label className="partner-media-choose"><Camera size={18} />{source ? 'Change image' : 'Choose image'}<input ref={input} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={choose} aria-label={`Choose ${label.toLowerCase()}`} /></label>
      {file && <div className="partner-media-actions"><button type="button" disabled={busy} onClick={save}><Check size={16} />{busy ? 'Uploading...' : 'Save image'}</button><button type="button" disabled={busy} onClick={() => { setFile(null); setError(''); if (input.current) input.current.value = '' }}><X size={16} />Cancel</button></div>}
      {error && <p role="alert" className="admin-login-error">{error}</p>}{message && <p role="status" className="partner-save-message">{message}</p>}
    </div>
  </section>
}
