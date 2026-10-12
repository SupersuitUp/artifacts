'use client'

// The bar at the bottom of a page that can be listened to, shared by the recorded-narration
// reader and the browser read-aloud, so a page looks the same whichever one is speaking. It is
// pure chrome: each reader owns its engine and hands the bar what to show and what to call.
//
// No narrator line (0.33.1, Gary: "read by freedom should be removed"): the bar is the play
// button, the seek line, the progress and the speed. The speed button has a FIXED width wide enough
// for its longest label ("1.25x"), so stepping 1x -> 1.25x -> 2x never resizes it and never shifts
// the seek line beside it (Gary: "the bottom bar speed dial shouldn't cause reflow when clicked").

export function PlayerBar({
  playing,
  onToggle,
  accent,
  ground,
  value,
  max,
  step,
  onSeek,
  progress,
  rate,
  onRate,
}: {
  playing: boolean
  onToggle: () => void
  /** Ignored since 0.33.1: the bar names no narrator. Kept so an older caller still compiles. */
  label?: string
  accent: string
  ground: string
  value: number
  max: number
  step: number
  onSeek: (value: number) => void
  /** The text at the right of the bar: a time for recorded audio, a word count for the browser. */
  progress: string
  rate: number
  onRate: () => void
}) {
  return (
    <>
      <style>{`
        .artifact-word { border-radius: 3px; transition: background-color 120ms; }
        .artifact-word:hover { background: var(--a-surface-strong, rgba(255,255,255,0.08)); cursor: pointer; }
        .artifact-word-lit { background: color-mix(in srgb, ${accent} 35%, transparent); color: var(--a-strong, #fff); }
      `}</style>
      <div data-artifact-player className="fixed inset-x-0 bottom-0 z-40 border-t border-[color:var(--a-line)] backdrop-blur" style={{ background: `color-mix(in srgb, ${ground} 90%, transparent)` }}>
        <div className="mx-auto flex max-w-2xl items-center gap-4 px-6 py-3">
          <button
            type="button"
            onClick={onToggle}
            aria-label={playing ? 'Pause narration' : 'Play narration'}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
            style={{ background: accent, color: ground }}
          >
            {playing ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
            )}
          </button>
          <div className="min-w-0 flex-1">
            <input
              type="range"
              min={0}
              max={max || 0}
              step={step}
              value={Math.min(value, max || 0)}
              onChange={(e) => onSeek(Number(e.target.value))}
              aria-label="Seek"
              className="block w-full"
              style={{ accentColor: accent }}
            />
          </div>
          <div className="w-16 shrink-0 text-right text-xs tabular-nums text-[color:var(--a-muted)]">
            {progress}
          </div>
          <button
            type="button"
            onClick={onRate}
            data-artifact-rate
            className="w-14 shrink-0 whitespace-nowrap rounded border border-[color:var(--a-line-strong)] py-1 text-center text-xs tabular-nums text-[color:var(--a-body)]"
            aria-label={`Playback speed, ${rate}x`}
          >
            {rate}x
          </button>
        </div>
      </div>
      <div className="h-20" aria-hidden />
    </>
  )
}

/** The speeds the speed button steps through, in order, wrapping back to the first. */
export const RATES = [1, 1.25, 1.5, 2] as const

export function nextRate(rate: number): number {
  const i = RATES.findIndex((r) => r > rate + 1e-9)
  return i === -1 ? RATES[0] : RATES[i]
}
