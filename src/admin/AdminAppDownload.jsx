import { useEffect, useState } from 'react'
import { Download, ShieldCheck } from 'lucide-react'
import { isInstalledNow } from '../app/install'
import '../app/installApp.css'

// Admin dashboard: "Download DOORSTEP Admin for Android", once the admin APK has been built (public/admin-app-release.json,
// written by the Android app workflow). Not listed on the public /download page. Hidden inside the installed app.
export function AdminAppDownload() {
  const [release, setRelease] = useState(null)
  useEffect(() => {
    let active = true
    fetch('/admin-app-release.json', { cache: 'no-store' }).then((response) => response.ok ? response.json() : null).then((data) => { if (active) setRelease(data) }).catch(() => undefined)
    return () => { active = false }
  }, [])
  if (!release?.available || !release.url || isInstalledNow()) return null
  const megabytes = release.sizeBytes ? `${(release.sizeBytes / 1_048_576).toFixed(1)} MB` : null
  return <section className="install-card" aria-label="Download the DOORSTEP Admin Android app">
    <span className="install-icon" aria-hidden="true"><img src="/icons/admin-192.png?v=1" alt="" width="44" height="44" /></span>
    <div>
      <b>DOORSTEP Admin for Android</b>
      <small>Version {release.version}{megabytes ? ` · ${megabytes}` : ''} · Android {release.minAndroid || '7.0'} or newer. Open the file on your phone and allow installing from this source.</small>
      {release.sha256 && <small className="install-hint"><ShieldCheck size={13} aria-hidden="true" /> SHA-256 {release.sha256.slice(0, 16)}…</small>}
    </div>
    <a className="install-btn" href={release.url} download><Download size={16} aria-hidden="true" /> Download</a>
  </section>
}
