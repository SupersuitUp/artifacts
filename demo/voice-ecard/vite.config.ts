// The voice eCard demo: the scene straight from src/, with a sample Thanksgiving card.
//   ./make-audio.sh            (once: the sample voice and its timings, into public/)
//   npx vite demo/voice-ecard --config demo/voice-ecard/vite.config.ts --port 5199
// Query: ?brand=1 (envelope: brand with a seal), ?nocover=1, ?bg=<BlessOut background name>.
// The art is read from a BlessOut checkout beside this repo (BLESSOUT, default github-repos/other-repos/blesscompanion).
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const blessout = process.env.BLESSOUT ?? resolve(__dirname, '../../../../../../other-repos/blesscompanion')
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  define: { __BLESSOUT__: JSON.stringify(`/@fs${blessout}/public`) },
  server: { fs: { allow: [resolve(__dirname, '../..'), blessout] } },
})
