import { existsSync, readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

const renderMapTokenFile = '/etc/secrets/VITE_MAP_PUBLIC_TOKEN'
const mapToken = process.env.VITE_MAP_PUBLIC_TOKEN || (existsSync(renderMapTokenFile) ? readFileSync(renderMapTokenFile, 'utf8').trim() : '')

export default defineConfig({
  define: mapToken ? { 'import.meta.env.VITE_MAP_PUBLIC_TOKEN': JSON.stringify(mapToken) } : {},
})
