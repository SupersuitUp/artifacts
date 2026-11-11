import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [
    react(),
    // A unit test of the hub template (test/local-sign-in.test.ts) imports a template file, whose
    // `@supersuit/artifacts` does not resolve from template/hub (it has its own package.json and no
    // node_modules). Point only those imports at this package's source; nothing else changes.
    {
      name: 'template-hub-self-import',
      enforce: 'pre',
      resolveId(id, importer) {
        if (id === '@supersuit/artifacts' && importer?.includes('/template/hub/')) return resolve(__dirname, 'src/index.ts')
        return null
      },
    },
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx,mjs}'],
  },
})
