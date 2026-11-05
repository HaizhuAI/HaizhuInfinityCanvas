import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  // bundle the workspace package (it ships TS source); keep real npm deps external
  noExternal: ['@hzc/core'],
  // node:sqlite is a Node builtin; esbuild must not strip the `node:` prefix
  platform: 'node',
})
