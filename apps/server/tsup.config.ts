import { cpSync, existsSync } from 'node:fs'
import { defineConfig } from 'tsup'

// Single self-contained ESM file: desktop (Electron resources/) and Docker both just run
// `node dist/index.mjs` with no node_modules. Real npm deps are bundled in too.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  outExtension: () => ({ js: '.mjs' }),
  noExternal: [/.*/],
  // bundled CJS deps (fastify & friends) call require(); give them one in ESM scope
  banner: { js: "import { createRequire as __hzcCreateRequire } from 'node:module'; const require = __hzcCreateRequire(import.meta.url);" },
  // built-in Agent Skills ship next to the bundle (dist/skills). Node API, not `cp`, so it works on Windows CI.
  onSuccess: async () => {
    if (existsSync('skills')) cpSync('skills', 'dist/skills', { recursive: true })
  },
})
