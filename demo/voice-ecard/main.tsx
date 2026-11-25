// The demo page: the real VoiceEcard and CommentLayer from src/, a sample Thanksgiving card, and a
// stubbed state API so a reply opens the real comment card with its recorder.
import { createRoot } from 'react-dom/client'
import { VoiceEcard } from '../../src/reader/voice-ecard.js'
import { CommentLayer } from '../../src/reader/comment-layer.js'
import { voiceEcardLook, letterBlockId, recordingName, dateLine } from '../../src/artifacts/voice-ecard-page.js'
import { freedomDefault } from '../../src/brand/pack.js'
import { themeCss } from '../../src/brand/theme.js'
import type { VoiceEcardSpec, VoiceEcardTiming } from '../../src/artifacts/voice-ecard.js'

declare const __BLESSOUT__: string
const q = new URLSearchParams(location.search)
const brand = q.has('brand')
const bg = q.get('bg') ?? 'loving-thanksgiving'

// Every state call answers empty, so the comment layer runs as on a page with no comments yet.
const realFetch = window.fetch.bind(window)
window.fetch = (async (u: RequestInfo | URL, init?: RequestInit) => {
  const url = String(u)
  if (url.startsWith('/api/')) return new Response(JSON.stringify({ entries: [], notes: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
  return realFetch(u, init)
}) as typeof fetch

const Mark = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden><path d="M12 2l2.6 6.9L22 9.3l-5.6 4.6L18.2 21 12 17.1 5.8 21l1.8-7.1L2 9.3l7.4-.4z" fill="currentColor" /></svg>
)

async function main() {
  const words = (await (await fetch('/timings.json')).json()) as VoiceEcardTiming[]
  const spec: VoiceEcardSpec = { from: 'Sam', occasion: 'thanksgiving', envelope: brand ? 'brand' : 'gold', audio: '/card.m4a', words, mark: true }
  const look = voiceEcardLook(spec, freedomDefault.type)
  const style = document.createElement('style')
  style.textContent = themeCss(freedomDefault)
  document.head.appendChild(style)
  document.body.setAttribute('data-artifact-theme', 'dark')
  createRoot(document.getElementById('app')!).render(
    <>
      <VoiceEcard rootId="voice-ecard-root" to="Robin" from="Sam" letter={words.map((w) => w.w).join(' ')} words={words} {...look}
        cover={q.has('nocover') ? undefined : `${__BLESSOUT__}/backgrounds/thanksgiving-dinner.png`}
        inner={`${__BLESSOUT__}/backgrounds/fall-leaves.png`} background={`${__BLESSOUT__}/backgrounds/${bg}.png`}
        audio="/card.m4a" media={recordingName('/card.m4a')} seal={brand ? <Mark /> : undefined} mark reply
        blockId={letterBlockId('Robin', 'Sam')} dateLine={dateLine('2026-11-26T12:00:00Z')} />
      <CommentLayer artifactId="demo2345" rootId="voice-ecard-root" ownerName="Sam" comments="anyone" canShare signedIn={false} isOwner={false}
        version={1} accent={freedomDefault.accent} ground={freedomDefault.ground} signIn={null} closesAt={null} requireName={false} knownName={null} />
    </>,
  )
}
void main()
