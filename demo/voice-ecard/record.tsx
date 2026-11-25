// The recorder demo: the real Recorder from src/, over an in-browser stand-in for the batch API
// (memoryRecordStore), so takes, mixes and the resume rule run without a host.
//   open http://localhost:5199/record.html  (?done=1 opens with the first person recorded; ?fakemic=1
//   records the demo voice instead of a microphone)
import { createRoot } from 'react-dom/client'
import { Recorder } from '../../src/reader/recorder.js'
import { memoryRecordStore } from '../../src/artifacts/record-store.js'
import { freedomDefault } from '../../src/brand/pack.js'
import { themeCss } from '../../src/brand/theme.js'

declare const __BLESSOUT__: string
// ?fakemic=1: headless Chrome cannot grant a microphone here, so the demo's microphone is the demo's
// own voice file played into a stream. MediaRecorder, the upload and the mix stay real.
if (new URLSearchParams(location.search).has('fakemic')) {
  navigator.mediaDevices.getUserMedia = async () => {
    const ctx = new AudioContext()
    const buf = await ctx.decodeAudioData(await (await fetch('/card.m4a')).arrayBuffer())
    const src = ctx.createBufferSource()
    src.buffer = buf
    const dest = ctx.createMediaStreamDestination()
    src.connect(dest)
    src.start()
    return dest.stream
  }
}
const store = memoryRecordStore()
;(window as unknown as { __store: typeof store }).__store = store // for the screenshot run to read back
const realFetch = window.fetch.bind(window)
let batchId = ''
window.fetch = (async (u: RequestInfo | URL, init: RequestInit = {}) => {
  const url = String(u)
  if (url.startsWith('demo://put')) return new Response(null, { status: 200 })
  const m = /^\/api\/record\/([^/]+)\/([^/]+)\/take/.exec(url)
  if (m) {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : {}
    if (!body.done) return new Response(JSON.stringify({ uploadUrl: 'demo://put', headers: {} }), { status: 201 })
    const ext = body.kind === 'raw' ? 'webm' : 'wav'
    const entry = await store.setTake(m[1], m[2], { kind: body.kind, path: `private:${m[2]}-${body.kind}.${body.digest}.${ext}`, mime: body.type, seconds: body.seconds, voiceDelay: body.voiceDelay })
    return new Response(JSON.stringify({ entry }), { status: 200 })
  }
  return realFetch(u, init)
}) as typeof fetch

async function main() {
  const style = document.createElement('style')
  style.textContent = themeCss(freedomDefault)
  document.head.appendChild(style)
  const b = await store.create({
    title: 'Thanksgiving 2026', music: `${location.origin}/bed.mp3`,
    people: [
      { slug: 'robin', name: 'Robin', photo: `${__BLESSOUT__}/backgrounds/family-silhouette.png`, note: 'Thank Robin for carrying so much this year: the early mornings, the late nights, the move.' },
      { slug: 'dana-lee', name: 'Dana Lee', note: 'The dinners every Sunday, and the way you made the new house feel like home.' },
      { slug: 'sam', name: 'Sam', note: 'Short and warm: proud of you.' },
    ],
  })
  batchId = b.id
  ;(window as unknown as { __batch: string }).__batch = b.id
  if (new URLSearchParams(location.search).has('done')) await store.setTake(b.id, 'robin', { kind: 'raw', path: 'private:robin-raw.webm' })
  const now = (await store.get(batchId))!
  createRoot(document.getElementById('app')!).render(<Recorder batch={now} accent={freedomDefault.accent} />)
}
void main()
