// Build step for the web image: turns dist/app-release.json (written by the "Android app" workflow) into the nginx
// rule for the permanent link /downloads/doorstep.apk. Same rules as worker.js: only a site APK or a GitHub
// release may be the target; before the first release the link is a plain 404.
// Usage: node make-apk-redirect.mjs <dist dir> <output .conf>
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const [distDir = 'dist', outFile = 'doorstep-apk-redirect.conf'] = process.argv.slice(2)
let release = null
try { release = JSON.parse(await readFile(join(distDir, 'app-release.json'), 'utf8')) } catch { release = null }

const target = release?.available && typeof release.url === 'string' ? release.url : null
const safe = target && (/^\/downloads\/DOORSTEP-[\w.-]+\.apk$/.test(target) || /^https:\/\/github\.com\/[\w./-]+$/.test(target))

const rule = safe
  ? `location = /downloads/doorstep.apk {\n  add_header Cache-Control "no-store" always;\n  return 302 ${target};\n}\n`
  : `location = /downloads/doorstep.apk {\n  add_header Cache-Control "no-store" always;\n  default_type "text/plain; charset=utf-8";\n  return 404 "The DOORSTEP Android app has not been published yet. Visit https://mydoorstep.com.co/download\\n";\n}\n`

await writeFile(outFile, `# Generated at image build from app-release.json. Do not edit.\n${rule}`)
console.log(safe ? `[apk-redirect] /downloads/doorstep.apk -> ${target}` : '[apk-redirect] no published release; link returns 404')
