// The door on a page with a password. A GET form, so the key lands in the URL exactly as an
// author's sent link carries it, and the page that opens is the same page the link opens.
import type { BrandPack } from '../brand/pack.js'

export function ArtifactDoor({ brand, wrongKey }: { brand: BrandPack; wrongKey: boolean }) {
  return (
    <form method="get" data-nospeak className="mx-auto max-w-sm px-6 pb-24 text-center">
      <label htmlFor="artifact-key" className="block text-sm opacity-70">
        This page is for the people it was written for. Enter the key you were given.
      </label>
      <input
        id="artifact-key"
        name="key"
        type="password"
        autoComplete="off"
        autoFocus
        className="mt-4 w-full rounded-lg border px-4 py-3 text-center text-base outline-none"
        style={{ borderColor: brand.accent, background: 'transparent', color: brand.ink }}
      />
      {wrongKey ? (
        <p className="mt-3 text-sm" style={{ color: brand.accent }}>
          That key did not open it.
        </p>
      ) : null}
      <button
        type="submit"
        className="mt-4 rounded-lg px-5 py-2 text-sm font-medium"
        style={{ background: brand.accent, color: brand.ground }}
      >
        Open
      </button>
    </form>
  )
}
