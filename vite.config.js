import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'vite'

const renderMapTokenFiles = [join(process.cwd(), 'VITE_MAP_PUBLIC_TOKEN'), '/etc/secrets/VITE_MAP_PUBLIC_TOKEN']
const renderMapTokenFile = renderMapTokenFiles.find(existsSync)
const mapToken = process.env.VITE_MAP_PUBLIC_TOKEN || (renderMapTokenFile ? readFileSync(renderMapTokenFile, 'utf8').trim() : '')

if (mapToken) process.env.VITE_MAP_PUBLIC_TOKEN = mapToken

export default defineConfig({
  define: mapToken ? { 'import.meta.env.VITE_MAP_PUBLIC_TOKEN': JSON.stringify(mapToken) } : {},
})
