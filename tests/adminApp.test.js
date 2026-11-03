import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import worker from '../worker.js'

// DOORSTEP Admin for Android: a second Trusted Web Activity built by the same workflow and key as the customer app.
const file = (path) => new URL(`../${path}`, import.meta.url)
const json = (path) => JSON.parse(readFileSync(file(path), 'utf8'))
const workflowPath = existsSync(file('.github/workflows/android-release.yml')) ? '.github/workflows/android-release.yml' : 'docs/github-workflows/android-release.yml'

test('the admin app is its own Android app that opens the admin, alongside the customer app', () => {
  const admin = json('android-admin/twa-manifest.json')
  const customer = json('android/twa-manifest.json')
  assert.equal(admin.packageId, 'co.com.mydoorstep.admin')
  assert.notEqual(admin.packageId, customer.packageId, 'installs next to the customer app')
  assert.equal(admin.host, customer.host)
  assert.ok(admin.startUrl.startsWith('/admin/'))
  assert.equal(admin.webManifestUrl, 'https://mydoorstep.com.co/admin.webmanifest')
  assert.equal(admin.signingKey.alias, 'doorstep', 'signed with the same key')
  assert.ok(existsSync(file(`public${new URL(admin.iconUrl).pathname}`)), 'icon exists')
  const release = json('public/admin-app-release.json')
  assert.equal(release.packageId, admin.packageId)
  if (release.available) assert.ok(release.url && /^[0-9a-f]{64}$/.test(release.sha256))
  const ignore = readFileSync(file('.gitignore'), 'utf8')
  assert.match(ignore, /^android-admin\/\*$/m)
  assert.match(ignore, /^!android-admin\/twa-manifest\.json$/m)
})

test('one workflow builds either app without breaking the other', () => {
  const workflow = readFileSync(file(workflowPath), 'utf8')
  assert.match(workflow, /options: \['doorstep', 'admin'\]/)
  assert.match(workflow, /PKG=co\.com\.mydoorstep\.admin/)
  assert.match(workflow, /map\(select\(\.target\.package_name != \$pkg\)\)/, 'keeps the other app in assetlinks.json')
  assert.doesNotMatch(workflow, /-name 'DOORSTEP-\*\.apk' -delete/, 'never deletes the other app’s download')
  assert.doesNotMatch(workflow, /run:[^\n]*\$\{\{\s*(secrets|inputs)\./, 'secrets and typed inputs reach commands only through env')
})

test('the admin app download lives inside the admin (signed in), separate from the public download page', () => {
  const admin = readFileSync(file('src/adminPages.jsx'), 'utf8')
  assert.ok(admin.includes("path === '/admin/download') content = <AdminAppPage />"), 'an admin page')
  assert.ok(!readFileSync(file('src/App.jsx'), 'utf8').includes('/admin/download'), 'no route outside the admin sign-in')
  assert.doesNotMatch(readFileSync(file('src/shop/DownloadPage.jsx'), 'utf8'), /admin/i, 'the public page is only for the customer app')
  assert.ok(readFileSync(file('src/admin/AdminAppPage.jsx'), 'utf8').includes("'/admin-app-release.json'"))
  assert.match(readFileSync(file('public/admin-download-qr.svg'), 'utf8'), /^<svg[^>]+viewBox/)
  assert.ok(readFileSync(file('src/admin/AdminHub.jsx'), 'utf8').includes("href: '/admin/download'"), 'in the admin menu')
})

test('admin release details are always fresh', async () => {
  const env = { ASSETS: { fetch: async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }) } }
  const response = await worker.fetch(new Request('https://mydoorstep.com.co/admin-app-release.json'), env)
  assert.equal(response.headers.get('Cache-Control'), 'no-cache')
})
