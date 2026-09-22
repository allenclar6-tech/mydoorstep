import { copyFile } from 'node:fs/promises'

await copyFile('dist/index.html', 'dist/404.html')
console.log('Prepared dist/404.html for Cloudflare SPA fallback.')
