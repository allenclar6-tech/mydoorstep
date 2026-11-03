import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

// Two installable apps from one site: DOORSTEP (customers, businesses, riders) and DOORSTEP Admin.
const read = (file) => JSON.parse(readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8'))
const publicFile = (src) => new URL(`../public${src.split('?')[0]}`, import.meta.url)

test('both app manifests are installable and point only at files that exist', () => {
  for (const [file, scope] of [['manifest.webmanifest', '/'], ['admin.webmanifest', '/admin/']]) {
    const manifest = read(file)
    assert.equal(manifest.scope, scope, file)
    assert.equal(manifest.id, scope, `${file}: a stable id keeps the two apps separate`)
    assert.ok(manifest.start_url.startsWith(scope), `${file}: start page is inside the app`)
    assert.equal(manifest.display, 'standalone')
    assert.ok(manifest.name && manifest.short_name.length <= 12, `${file}: short name fits under an icon`)
    const sizes = manifest.icons.map((icon) => icon.sizes)
    assert.ok(sizes.includes('192x192') && sizes.includes('512x512'), `${file}: 192 and 512 icons`)
    for (const icon of [...manifest.icons, ...manifest.shortcuts.flatMap((shortcut) => shortcut.icons || [])]) assert.ok(existsSync(publicFile(icon.src)), `${file}: ${icon.src} exists`)
    for (const shortcut of manifest.shortcuts) assert.ok(shortcut.url.startsWith(scope), `${file}: shortcut ${shortcut.url} stays in the app`)
  }
  assert.notEqual(read('manifest.webmanifest').name, read('admin.webmanifest').name)
})

test('the service worker shows an offline screen but never caches pages or data', () => {
  const worker = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
  assert.ok(existsSync(new URL('../public/offline.html', import.meta.url)))
  assert.match(worker, /mode !== 'navigate'\) return/, 'only page loads are handled')
  assert.doesNotMatch(worker, /cache\.put\(/, 'nothing fetched is ever stored')
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  assert.match(html, /admin\.webmanifest/, 'admin pages switch to the Admin app manifest')
})
