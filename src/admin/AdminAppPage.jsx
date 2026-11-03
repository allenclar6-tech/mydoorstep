import { useEffect, useState } from 'react'
import { Bell, Check, Copy, Download, Monitor, QrCode, Share2, ShieldCheck, Smartphone } from 'lucide-react'
import { InstallApp } from '../app/InstallApp'
import { PushPrompt } from '../notifications/PushPrompt'
import './adminApp.css'

// Admin › Download the app: the DOORSTEP Admin Android app (from /admin-app-release.json, written by the "Android app"
// GitHub workflow), installing from the browser, notifications on this device, and a QR code to open this page on a phone.

const sizeText = (bytes) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
const dateText = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

/** Release details, with a check that a link on this website really serves the APK before showing the button. */
function useAdminRelease() {
  const [state, setState] = useState({ loading: true, release: null, linkOk: false })
  useEffect(() => {
    let active = true
    fetch('/admin-app-release.json', { cache: 'no-cache' }).then((response) => response.ok ? response.json() : null).then(async (release) => {
      let linkOk = false
      if (release?.available && release.url) {
        if (release.url.startsWith('/')) {
          const head = await fetch(release.url, { method: 'HEAD', cache: 'no-cache' }).catch(() => null)
          linkOk = Boolean(head?.ok && !head.headers.get('Content-Type')?.includes('text/html'))
        } else linkOk = /^https:\/\//.test(release.url)
      }
      if (active) setState({ loading: false, release, linkOk })
    }).catch(() => { if (active) setState({ loading: false, release: null, linkOk: false }) })
    return () => { active = false }
  }, [])
  return state
}

export function AdminAppPage() {
  const { loading, release, linkOk } = useAdminRelease()
  const ready = Boolean(release?.available && linkOk)
  const [copied, setCopied] = useState('')
  const copy = async (text, what) => { try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(''), 2000) } catch { /* clipboard blocked */ } }

  return <div className="fa aa">
    <section className="fa-card aa-hero">
      <img src="/icons/admin-192.png?v=1" alt="" width="64" height="64" />
      <div><h3>DOORSTEP Admin app</h3><p className="fa-muted">Run DOORSTEP from your phone: live orders and deliveries, payments, payouts, approvals and alerts — in its own app with the ADMIN icon, next to the customer app. It holds no passwords; it needs your admin sign-in.</p></div>
    </section>

    <section className="fa-card" aria-labelledby="aa-android">
      <h3 id="aa-android"><Smartphone size={17} aria-hidden="true" /> Android</h3>
      {loading ? <p className="fa-muted" role="status">Checking the latest version…</p>
        : ready ? <>
          <a className="admin-primary aa-download" href={release.url} download={release.url.startsWith('/') ? `DOORSTEP-Admin-${release.version}.apk` : undefined} rel="noopener"><Download size={17} aria-hidden="true" /> Download DOORSTEP Admin for Android</a>
          <dl className="aa-facts">
            <div><dt>Version</dt><dd>{release.version}</dd></div>
            <div><dt>Size</dt><dd>{sizeText(release.sizeBytes)}</dd></div>
            <div><dt>Updated</dt><dd>{dateText(release.releasedAt)}</dd></div>
            <div><dt>Needs</dt><dd>Android {release.minAndroid || '5.0'}+</dd></div>
          </dl>
          {release.notes && <p className="fa-muted"><b>What’s new:</b> {release.notes}</p>}
          <details className="aa-checksum"><summary><ShieldCheck size={15} aria-hidden="true" /> Check the file (SHA-256)</summary>
            <code>{release.sha256}</code>
            <button type="button" className="row-more" onClick={() => copy(release.sha256, 'sha')}>{copied === 'sha' ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}</button>
          </details>
          <ol className="aa-steps">
            <li><b>Tap Download</b> on the phone you want to use. Chrome may warn about this type of file — continue only on mydoorstep.com.co.</li>
            <li><b>Open the downloaded file</b> from the notification or Downloads.</li>
            <li><b>Allow this one install</b> if Android asks (“Allow from this source” for your browser), then go back.</li>
            <li><b>Install, open, and sign in</b> with your admin account. Keep Google Play Protect on.</li>
          </ol>
        </> : <div className="aa-soon">
          <b>{release?.available && !linkOk ? 'The download isn’t reachable right now' : 'Not built yet'}</b>
          <p>{release?.available && !linkOk ? 'Try again in a little while.' : 'Build it once on GitHub: Actions → Android app → Run workflow → choose “admin” → version 1.0.0. Then pull and deploy the website, and the Download button appears here. Until then, install it from your browser below.'}</p>
        </div>}
    </section>

    <section className="fa-card" aria-labelledby="aa-browser">
      <h3 id="aa-browser"><Monitor size={17} aria-hidden="true" /> iPhone, iPad and computers</h3>
      <p className="fa-muted">No download needed: install DOORSTEP Admin straight from the browser. On iPhone open this page in Safari, tap <Share2 size={13} aria-label="Share" /> Share, then “Add to Home Screen”.</p>
      <InstallApp who="admin" always />
    </section>

    <section className="fa-card" aria-labelledby="aa-alerts">
      <h3 id="aa-alerts"><Bell size={17} aria-hidden="true" /> Alerts on this device</h3>
      <p className="fa-muted">Bank transfers to confirm, refunds, withdrawal requests, orders waiting for a rider and new help messages — as phone notifications.</p>
      <PushPrompt who="admin" admin always />
    </section>

    <section className="fa-card aa-qr" aria-labelledby="aa-qr">
      <img src="/admin-download-qr.svg" alt="QR code for this page" width="132" height="132" />
      <div>
        <h3 id="aa-qr"><QrCode size={17} aria-hidden="true" /> On a computer?</h3>
        <p className="fa-muted">Scan with your phone’s camera to open this page there, sign in, and download.</p>
        <button type="button" className="row-more" onClick={() => copy('https://mydoorstep.com.co/admin/download', 'link')}>{copied === 'link' ? <><Check size={14} /> Link copied</> : <><Copy size={14} /> Copy link</>}</button>
      </div>
    </section>

    <section className="fa-card" aria-labelledby="aa-public">
      <h3 id="aa-public">The customer app</h3>
      <p className="fa-muted">For customers, businesses and riders, share <b>mydoorstep.com.co/download</b> — that’s the public DOORSTEP app, not this one.</p>
      <button type="button" className="row-more aa-inline" onClick={() => copy('https://mydoorstep.com.co/download', 'public')}>{copied === 'public' ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy customer link</>}</button>
    </section>
  </div>
}
