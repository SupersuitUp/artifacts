// The title card a page unfurls as when it has no cover: kicker, title, the pack's backdrop.
// Drawn with next/og (Satori), which lays out a subset of CSS: flex only, inline styles, no
// blur or glow. Anything atmospheric is the backdrop's job. The lower-left corner is left
// clear, because a backdrop may put a small mark there.
import { ImageResponse } from 'next/og'
import type { BrandPack } from './pack.js'

export const SHARE_W = 1200
export const SHARE_H = 630

type Loaded = { font: { name: string; data: ArrayBuffer; weight: number }; backdrop?: string }
const loaded = new WeakMap<BrandPack, Promise<Loaded>>()

function assetsFor(pack: BrandPack): Promise<Loaded> {
  let p = loaded.get(pack)
  if (!p) {
    const share = pack.share!
    p = Promise.all([share.font(), share.backdrop?.()]).then(([font, backdrop]) => ({ font, backdrop }))
    loaded.set(pack, p)
  }
  return p
}

/** Titles get smaller as they get longer, so three lines always fit above the mark. */
export function titleSize(title: string): number {
  if (title.length <= 40) return 76
  if (title.length <= 80) return 62
  return 52
}

export function ShareCard({ pack, title, fontName, backdrop }: { pack: BrandPack; title: string; fontName: string; backdrop?: string }) {
  const size = titleSize(title)
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: SHARE_W,
        height: SHARE_H,
        padding: '96px 96px 0',
        backgroundColor: pack.ground,
        ...(backdrop ? { backgroundImage: `url(${backdrop})`, backgroundSize: `${SHARE_W}px ${SHARE_H}px` } : {}),
        color: pack.ink,
        fontFamily: fontName,
      }}
    >
      <div style={{ display: 'flex', fontSize: 22, letterSpacing: 5, textTransform: 'uppercase', color: pack.accent, fontWeight: 500 }}>
        {pack.kicker}
      </div>
      <div style={{ display: 'flex', marginTop: 28, fontSize: size, lineHeight: 1.18, maxWidth: 980, lineClamp: 3 }}>{title}</div>
    </div>
  )
}

/** A 1200x630 PNG for one page. Caller has already checked `pack.share` exists. */
export async function renderShareCard(pack: BrandPack, title: string): Promise<Response> {
  const { font, backdrop } = await assetsFor(pack)
  return new ImageResponse(<ShareCard pack={pack} title={title} fontName={font.name} backdrop={backdrop} />, {
    width: SHARE_W,
    height: SHARE_H,
    fonts: [{ name: font.name, data: font.data, weight: font.weight as 600, style: 'normal' }],
    headers: { 'cache-control': 'public, max-age=3600, s-maxage=31536000, stale-while-revalidate=86400' },
  })
}
