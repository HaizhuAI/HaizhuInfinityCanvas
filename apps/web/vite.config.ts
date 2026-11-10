import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Writes a .br and a .gz next to every text asset of the build, so the server can send the UI
 * compressed without compressing on each request (it serves them with `preCompressed`).
 * The UI is ~750 kB uncompressed and ~200 kB compressed, which matters when the WebUI is opened over
 * a network rather than from this computer.
 */
function precompress(): Plugin {
  const TEXT = /\.(?:js|css|html|svg|json|txt|map)$/
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]))
  let outDir = 'dist'
  return {
    name: 'hzc-precompress',
    apply: 'build',
    configResolved(c) { outDir = join(c.root, c.build.outDir) },
    closeBundle() {
      for (const file of walk(outDir)) {
        if (!TEXT.test(file) || file.endsWith('.map') || statSync(file).size < 1024) continue
        const data = readFileSync(file)
        writeFileSync(`${file}.br`, brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } }))
        writeFileSync(`${file}.gz`, gzipSync(data, { level: 9 }))
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), precompress()],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8787' } },
  build: { outDir: 'dist', sourcemap: true },
})
