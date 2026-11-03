import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import worker from '../worker.js'

// The app download system: release details for /download, Android app links, the TWA config and the website rules.
const file = (path) => new URL(`../${path}`, import.meta.url)
const json = (path) => JSON.parse(readFileSync(file(path), 'utf8'))

test('release details never claim an APK that isn’t there', () => {
  const release = json('public/app-release.json')
  assert.equal(release.packageId, json('android/twa-manifest.json').packageId)
  if (!release.available) { assert.ok(release.message); return }
  for (const key of ['version', 'releasedAt', 'sizeBytes', 'sha256', 'url']) assert.ok(release[key], `${key} is set`)
  assert.match(release.sha256, /^[0-9a-f]{64}$/)
  assert.ok(release.url.startsWith('https://') || release.url.startsWith('/downloads/'), 'HTTPS or this website only')
  if (release.url.startsWith('/downloads/')) assert.ok(existsSync(file(`public${release.url}`)), 'the APK file is in public/downloads')
})

test('the Android app config points at the live site and keeps the signing key out of git', () => {
  const twa = json('android/twa-manifest.json')
  assert.equal(twa.host, 'mydoorstep.com.co')
  assert.ok(twa.startUrl.startsWith('/'))
  assert.equal(twa.signingKey.alias, 'doorstep')
  const ignore = readFileSync(file('.gitignore'), 'utf8')
  assert.match(ignore, /^\*\.keystore$/m)
  const workflow = readFileSync(file(existsSync(file('.github/workflows/android-release.yml')) ? '.github/workflows/android-release.yml' : 'docs/github-workflows/android-release.yml'), 'utf8')
  assert.doesNotMatch(workflow, /run:[^\n]*\$\{\{\s*(secrets|inputs)\./, 'secrets and typed inputs reach commands only through env')
  assert.ok(Array.isArray(json('public/assetlinks.json')))
  assert.match(readFileSync(file('public/download-qr.svg'), 'utf8'), /^<svg[^>]+viewBox/)
})

test('the website serves app links, APKs and release details correctly', async () => {
  const files = { '/assetlinks.json': ['[]', 'application/json'], '/app-release.json': ['{}', 'application/json'], '/downloads/DOORSTEP-1.0.0.apk': ['APK', 'application/octet-stream'] }
  const env = { ASSETS: { fetch: async (request) => { const hit = files[new URL(request.url).pathname]; return hit ? new Response(hit[0], { headers: { 'Content-Type': hit[1] } }) : new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } }) } } }
  const get = (path) => worker.fetch(new Request(`https://mydoorstep.com.co${path}`), env)
  let response = await get('/.well-known/assetlinks.json')
  assert.equal(response.headers.get('Content-Type'), 'application/json')
  response = await get('/downloads/DOORSTEP-1.0.0.apk')
  assert.equal(response.headers.get('Content-Type'), 'application/vnd.android.package-archive')
  assert.match(response.headers.get('Content-Disposition'), /attachment/)
  assert.equal((await get('/downloads/DOORSTEP-0.0.1.apk')).status, 404, 'a missing APK is a real 404, not the home page')
  assert.equal((await get('/app-release.json')).headers.get('Cache-Control'), 'no-cache')
})
