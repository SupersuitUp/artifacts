// The thin page a file artifact is (any-file artifacts, 2026-11-11). It ports file-page.html: the hub
// reader's kicker, title and "For <name>" line, and the voice note's box holding the file. A PDF, an
// image, a video or a sound shows in the browser's own viewer; everything else is a download. The
// hub never reads inside a file, so the box says the size and the date, never a page count.
import type { FileBody } from './file-page.js'
import { fileNoun, sizeWords } from './file-page.js'

const BTN = 'inline-flex min-h-11 items-center gap-2 rounded-full px-[1.15rem] text-[0.95rem] font-semibold'
const day = (iso: string) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '' }

export function FileCard({ owner, title, label, file, links, display, updatedAt }: {
  owner: string; title: string; label: string | null; file: FileBody | null
  links: { open: string | null; download: string } | null; display: string; updatedAt: string
}) {
  const kicker = (
    <p data-nospeak className="flex items-center gap-[0.6rem] text-[11px] uppercase tracking-[0.2em] text-[color:var(--a-accent)]">
      <span aria-hidden="true" className="inline-block h-px w-7 bg-[color:var(--a-accent)]" />{`A file from ${owner}`}
    </p>
  )
  const { cap } = fileNoun(file?.type ?? 'application/octet-stream')
  const type = file?.type ?? ''
  return (
    <main data-file-page className="mx-auto max-w-2xl px-4 pt-12 pb-12 text-[17px] leading-[1.65] text-[color:var(--a-body)]">
      {kicker}
      <h1 className="mt-[0.9rem] text-[2.4rem] leading-[1.1] text-[color:var(--a-strong)]" style={{ fontFamily: display }}>{title}</h1>
      {label ? <p data-for-reader className="mt-3 text-[0.95rem] text-[color:var(--a-muted)]">{`For ${label}. This link is yours alone.`}</p> : null}
      <div data-file-card className="my-7 rounded-xl border border-[color:var(--a-line)] bg-[color:var(--a-surface)] px-5 pb-5 pt-4 shadow-sm">
        <span className="block text-[11px] uppercase tracking-[0.2em] text-[color:var(--a-accent)]">{cap}</span>
        <span className="mt-1 block break-words font-serif text-lg italic text-[color:var(--a-strong)]">{file?.name ?? title}</span>
        {file ? <div className="mt-1 font-mono text-xs text-[color:var(--a-muted)]">{`${sizeWords(file.bytes)} · updated ${day(updatedAt)}`}</div> : null}
        {!links ? (
          <p className="mt-4 text-sm text-[color:var(--a-muted)]">The file is still on its way. Open this link again in a minute.</p>
        ) : (
          <>
            {links.open && type === 'application/pdf' ? (
              <object data={links.open} type="application/pdf" aria-label={file?.name}
                className="mt-[0.9rem] block h-[30rem] w-full rounded-lg border border-[color:var(--a-line)] bg-[color:var(--a-surface-strong)]" />
            ) : links.open && type.startsWith('image/') ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img data-file-image src={links.open} alt={file?.name ?? ''} className="mt-[0.9rem] w-full rounded-lg border border-[color:var(--a-line)]" />
            ) : links.open && type.startsWith('video/') ? (
              <video src={links.open} controls preload="metadata" className="mt-[0.9rem] w-full rounded-lg border border-[color:var(--a-line)] bg-black" />
            ) : links.open && type.startsWith('audio/') ? (
              <audio src={links.open} controls preload="none" className="mt-[0.9rem] w-full" />
            ) : (
              <p className="mt-3 text-[0.8rem] text-[color:var(--a-muted)]">This page does not show this kind of file. Download it to open it.</p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-[0.6rem]">
              {links.open && type === 'application/pdf' ? (
                <a href={links.open} target="_blank" rel="noopener noreferrer" className={`${BTN} bg-[color:var(--a-accent)] text-[color:var(--a-on-accent)]`}>Open the PDF</a>
              ) : null}
              <a href={links.download} download={file?.name}
                className={`${BTN} ${links.open && type === 'application/pdf' ? 'text-[color:var(--a-strong)] shadow-[inset_0_0_0_1.5px_var(--a-line-strong)]' : 'bg-[color:var(--a-accent)] text-[color:var(--a-on-accent)]'}`}>Download</a>
            </div>
          </>
        )}
      </div>
      <footer className="mt-10 border-t border-[color:var(--a-line)] pt-4">{kicker}</footer>
    </main>
  )
}
