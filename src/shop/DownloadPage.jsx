import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowLeft, Bell, Bike, Check, ChevronDown, Copy, Download, LayoutDashboard, ShieldCheck, Smartphone, Store, Wallet } from 'lucide-react'
import { InstallApp } from '../app/InstallApp'
import { isIos } from '../notifications/push'
import { navigate } from './shopData'

// /download — "Get the DOORSTEP app", and /admin/download — "Get the DOORSTEP Admin app". The Android APK details
// come from /app-release.json or /admin-app-release.json, which the "Android app" GitHub workflow writes after it
// has built, signed and published a real APK. Until then the page says the APK isn't ready and offers the browser
// install (PWA) instead — never a broken or made-up link.

const APPS = {
  doorstep: {
    release: '/app-release.json', file: 'DOORSTEP', icon: '/icons/icon-192.png?v=3', back: '/', installWho: 'customer', qr: '/download-qr.svg', page: 'mydoorstep.com.co/download',
    title: 'Get the DOORSTEP app', intro: 'Food, groceries, shops and packages — delivered across Delta, Edo and Rivers. Order in one tap and track your rider live.',
    soon: 'The first Android version hasn’t been published yet. Until then, install DOORSTEP straight from your browser below — it works the same way.',
    signIn: 'Sign in with your DOORSTEP account — customer, business or rider.',
    whoTitle: 'One app for everyone',
    who: [[Smartphone, 'Customers', 'Order food, groceries and more, or send a package.'], [Store, 'Restaurants and shops', 'Sign in to take orders, pause your store and see your sales.'], [Bike, 'Riders', 'Go online, accept jobs and track your earnings.']],
  },
  admin: {
    release: '/admin-app-release.json', file: 'DOORSTEP-Admin', icon: '/icons/admin-192.png?v=1', back: '/admin/dashboard', installWho: 'admin', qr: '/admin-download-qr.svg', page: 'mydoorstep.com.co/admin/download',
    title: 'Get the DOORSTEP Admin app', intro: 'Run DOORSTEP from your phone: live orders and deliveries, payments, payouts, approvals and alerts — in its own app with the ADMIN icon.',
    soon: 'The first Admin Android version hasn’t been published yet. Until then, install DOORSTEP Admin straight from your browser below — it works the same way.',
    signIn: 'Sign in with your DOORSTEP admin account. The app holds no passwords; without an admin login it shows nothing.',
    whoTitle: 'What you can do in the Admin app',
    who: [[LayoutDashboard, 'Today at a glance', 'Live orders, riders online, sales and everything waiting for you.'], [Wallet, 'Money', 'Confirm bank transfers, pay partners, send refunds and approve withdrawals.'], [Bell, 'Alerts', 'Notifications for new orders, stuck deliveries, payments and help messages.']],
  },
}

const sizeText = (bytes) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
const dateText = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

/** Loads the release details, and checks a link on this website really serves an APK before showing the button. */
function useRelease(path) {
  const [state, setState] = useState({ loading: true, release: null, linkOk: false })
  useEffect(() => {
    let active = true
    fetch(path, { cache: 'no-cache' }).then((response) => response.ok ? response.json() : null).then(async (release) => {
      if (!release?.available || !release.url) { if (active) setState({ loading: false, release, linkOk: false }); return }
      let linkOk = true
      // Same-site links are checked here; GitHub links were already checked by the workflow before publishing.
      if (release.url.startsWith('/')) {
        const head = await fetch(release.url, { method: 'HEAD', cache: 'no-cache' }).catch(() => null)
        linkOk = Boolean(head?.ok && !head.headers.get('Content-Type')?.includes('text/html'))
      } else linkOk = /^https:\/\//.test(release.url)
      if (active) setState({ loading: false, release, linkOk })
    }).catch(() => { if (active) setState({ loading: false, release: null, linkOk: false }) })
    return () => { active = false }
  }, [path])
  return state
}

/** Search engines: describe the app only once a real APK exists (no ratings, nothing invented). */
function useSeo(release, ready, enabled) {
  useEffect(() => {
    if (!enabled) return undefined
    const previous = document.title
    document.title = 'Download the DOORSTEP app — food & delivery in Nigeria'
    const meta = document.querySelector('meta[name="description"]')
    const previousDescription = meta?.content
    if (meta) meta.content = 'Get DOORSTEP on your phone: order food, groceries and more, send packages, and track your rider live across Delta, Edo and Rivers. Free Android app and browser install.'
    let script = null
    if (ready) {
      script = document.createElement('script')
      script.type = 'application/ld+json'
      script.textContent = JSON.stringify({ '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'DOORSTEP', operatingSystem: 'Android', applicationCategory: 'ShoppingApplication', softwareVersion: release.version, datePublished: release.releasedAt, fileSize: sizeText(release.sizeBytes), downloadUrl: new URL(release.url, window.location.origin).href, offers: { '@type': 'Offer', price: '0', priceCurrency: 'NGN' } })
      document.head.appendChild(script)
    }
    return () => { document.title = previous; if (meta && previousDescription != null) meta.content = previousDescription; script?.remove() }
  }, [ready, enabled])
}

export function DownloadPage({ app = 'doorstep' }) {
  const config = APPS[app]
  const admin = app === 'admin'
  const { loading, release, linkOk } = useRelease(config.release)
  const ready = Boolean(release?.available && linkOk)
  const [copied, setCopied] = useState(false)
  const [openFaq, setOpenFaq] = useState(null)
  useSeo(release, ready, !admin)
  // The admin download page stays out of search results.
  useEffect(() => {
    if (!admin) return undefined
    const previous = document.title
    document.title = 'Download DOORSTEP Admin'
    const robots = document.createElement('meta'); robots.name = 'robots'; robots.content = 'noindex'; document.head.appendChild(robots)
    return () => { document.title = previous; robots.remove() }
  }, [admin])
  const ios = isIos()
  const copy = async () => { try { await navigator.clipboard.writeText(release.sha256); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* clipboard blocked */ } }

  const faqs = admin ? [
    ['Is the Admin app safe?', 'Yes, when you download it from this page or DOORSTEP’s official GitHub page. Each version is signed with DOORSTEP’s own key and listed with its SHA-256 checksum. It contains no passwords or keys — it opens mydoorstep.com.co/admin, so it shows nothing without an admin login.'],
    ['Can I have both apps on one phone?', 'Yes. DOORSTEP Admin installs next to the customer DOORSTEP app, with its own green ADMIN icon.'],
    ['How do I get updates?', 'The app opens the live admin, so new features arrive automatically. When a new app version is needed, it appears on this page and on your dashboard.'],
    ['I have an iPhone', 'Open mydoorstep.com.co/admin in Safari, tap Share, then “Add to Home Screen”. DOORSTEP Admin then opens like an app, with notifications on iOS 16.4 and newer.'],
  ] : [
    ['Is the Android app safe?', 'Yes, when you download it from mydoorstep.com.co/download or DOORSTEP’s official GitHub page. Each version is signed with DOORSTEP’s own key and listed with its SHA-256 checksum, so you can confirm the file wasn’t changed. Don’t install DOORSTEP files sent to you by other people.'],
    ['Why isn’t it on the Play Store yet?', 'DOORSTEP is starting with a free direct download. The app is ready for the Play Store, and it will be listed there later.'],
    ['How do I get updates?', 'The app opens the live DOORSTEP service, so new features arrive automatically. When a new app version is needed, it appears on this page.'],
    ['I have an iPhone', 'Open mydoorstep.com.co in Safari, tap Share, then “Add to Home Screen”. DOORSTEP then opens like an app, with notifications on iOS 16.4 and newer.'],
    ['What still needs the internet?', 'Everything live: stores and prices, ordering, payments, rider tracking and notifications. Without internet the app shows a friendly “You’re offline” screen.'],
  ]

  return <div className={`sp-screen dl-page${admin ? ' is-admin' : ''}`}>
    <header className="dl-band">
      <button type="button" className="dl-back" onClick={() => (admin ? window.location.assign(config.back) : navigate(config.back))} aria-label="Back"><ArrowLeft size={20} /></button>
      <div className="dl-hero">
        <img src={config.icon} alt="" width="88" height="88" className="dl-icon" />
        <h1>{config.title}</h1>
        <p>{config.intro}</p>
      </div>
    </header>

    <main className="sp-body dl-body">
      <section className="dl-card dl-android" aria-labelledby="dl-android-title">
        <div className="dl-card-head"><span className="dl-badge" aria-hidden="true"><Smartphone size={20} /></span><div><h2 id="dl-android-title">Android</h2><p>Direct download (APK) · free</p></div></div>
        {loading ? <div className="sp-skeleton dl-skeleton" role="status" aria-label="Checking the latest version" />
          : ready ? <>
            <a className="dl-button" href={release.url} download={release.url.startsWith('/') ? `${config.file}-${release.version}.apk` : undefined} rel="noopener"><Download size={20} aria-hidden="true" />Download for Android</a>
            <dl className="dl-facts">
              <div><dt>Version</dt><dd>{release.version}</dd></div>
              <div><dt>Size</dt><dd>{sizeText(release.sizeBytes)}</dd></div>
              <div><dt>Updated</dt><dd>{dateText(release.releasedAt)}</dd></div>
              <div><dt>Needs</dt><dd>Android {release.minAndroid || '5.0'}+</dd></div>
            </dl>
            {release.notes && <p className="dl-notes"><b>What’s new:</b> {release.notes}</p>}
            <details className="dl-checksum"><summary><ShieldCheck size={16} aria-hidden="true" />Check the file (SHA-256)</summary>
              <code>{release.sha256}</code>
              <button type="button" className="sp-ghost" onClick={copy}>{copied ? <><Check size={15} aria-hidden="true" />Copied</> : <><Copy size={15} aria-hidden="true" />Copy</>}</button>
              <small>Compare this with the checksum of the downloaded file. If they differ, don’t install it.</small>
            </details>
          </> : <div className="dl-soon">
            <b>The Android app is on its way</b>
            <p>{release?.available && !linkOk ? 'The download isn’t reachable right now. Please try again in a little while.' : config.soon}</p>
          </div>}
      </section>

      <section className="dl-card" aria-labelledby="dl-web-title">
        <div className="dl-card-head"><span className="dl-badge is-mint" aria-hidden="true"><Download size={20} /></span><div><h2 id="dl-web-title">Install from your browser</h2><p>{ios ? 'iPhone and iPad (Safari)' : 'Android, iPhone and computers'} · no download needed</p></div></div>
        <InstallApp who={config.installWho} always />
      </section>

      <section className="dl-card dl-qr" aria-labelledby="dl-qr-title">
        <img src={config.qr} alt={`QR code for ${config.page}`} width="164" height="164" />
        <div><h2 id="dl-qr-title">On a computer?</h2><p>Scan this code with your phone’s camera to open this page there.</p><small>{config.page}</small></div>
      </section>

      {ready && <section className="dl-card" aria-labelledby="dl-steps-title">
        <h2 id="dl-steps-title" className="dl-h2">How to install on Android</h2>
        <ol className="dl-steps">
          <li><span>1</span><div><b>Tap “Download for Android”</b><small>Your browser saves the {admin ? 'DOORSTEP Admin' : 'DOORSTEP'} file. It may say this type of file can be harmful — tap Download anyway only if you’re on mydoorstep.com.co.</small></div></li>
          <li><span>2</span><div><b>Open the downloaded file</b><small>Tap the notification, or find it in Downloads / Files.</small></div></li>
          <li><span>3</span><div><b>Allow this one install</b><small>Android may say it isn’t allowed to install unknown apps from your browser. Tap Settings, switch on “Allow from this source” for that browser only, then go back.</small></div></li>
          <li><span>4</span><div><b>Tap Install, then Open</b><small>{config.signIn}</small></div></li>
        </ol>
        <p className="dl-warning"><AlertTriangle size={18} aria-hidden="true" /><span>After installing, you can switch “Install unknown apps” off again for your browser. Keep Google Play Protect on — DOORSTEP never asks you to turn off your phone’s security.</span></p>
      </section>}

      <section className="dl-card" aria-labelledby="dl-who-title">
        <h2 id="dl-who-title" className="dl-h2">{config.whoTitle}</h2>
        <ul className="dl-who">
          {config.who.map(([Icon, title, text]) => <li key={title}><Icon size={20} aria-hidden="true" /><span><b>{title}</b><small>{text}</small></span></li>)}
        </ul>
      </section>

      <section className="dl-faq" aria-labelledby="dl-faq-title">
        <h2 id="dl-faq-title" className="dl-h2">Questions</h2>
        {faqs.map(([question, answer], index) => <div key={question} className={`dl-faq-item${openFaq === index ? ' is-open' : ''}`}>
          <button type="button" aria-expanded={openFaq === index} onClick={() => setOpenFaq(openFaq === index ? null : index)}>{question}<ChevronDown size={18} aria-hidden="true" /></button>
          {openFaq === index && <p>{answer}</p>}
        </div>)}
      </section>
    </main>
  </div>
}

/** /admin/download — the DOORSTEP Admin app. Open without signing in, so it can be set up on a new phone. */
export function AdminDownloadPage() {
  return <DownloadPage app="admin" />
}
