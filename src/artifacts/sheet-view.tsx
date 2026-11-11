'use client'
// A spreadsheet on the file page (Task 25, 2026-11-11). The reader's BROWSER fetches the same
// private signed URL the Download button uses, loads SheetJS Community Edition (vendored, pinned,
// see vendor/sheetjs/README.md) with a dynamic import on mount, and draws the FIRST sheet as a
// read-only table of text. The hub server never fetches or parses the file, and never loads SheetJS:
// its render is the fallback line, which stays until a table is ready. Anything that fails (a bucket
// with no CORS rule for this origin, the network, a file SheetJS cannot read) leaves that line.
import { useEffect, useState } from 'react'
import type * as SheetJS from '../../vendor/sheetjs/xlsx.mjs'

export const SHEET_ROWS = 500
export const SHEET_COLS = 50
export const FALLBACK_LINE = 'This page does not show this kind of file. Download it to open it.'
const LINE = 'mt-3 text-[0.8rem] text-[color:var(--a-muted)]'
const CELL = 'whitespace-nowrap border border-[color:var(--a-line)] px-[0.45rem] py-[0.3rem] text-left'

type X = Pick<typeof SheetJS, 'read' | 'utils'>
export type Drawn = { cols: string[]; rows: string[][]; cap: string | null }

function capLine(rows: boolean, cols: boolean): string | null {
  if (rows && cols) return `Showing the first ${SHEET_ROWS} rows and ${SHEET_COLS} columns. Download it to see all of it.`
  if (rows) return `Showing the first ${SHEET_ROWS} rows. Download it to see all of it.`
  if (cols) return `Showing the first ${SHEET_COLS} columns. Download it to see all of it.`
  return null
}

/** The first sheet as text, at most 500 rows by 50 columns. Throws when there is nothing to draw. */
export function drawSheet(data: ArrayBuffer, X: X): Drawn {
  // sheetRows stops the parse one row past the cap; `!fullref` still says how big the sheet is.
  const wb = X.read(new Uint8Array(data), { type: 'array', sheetRows: SHEET_ROWS + 1, cellHTML: false, cellFormula: false })
  const ws = wb.SheetNames.length ? wb.Sheets[wb.SheetNames[0]] : undefined
  const ref = ws?.['!fullref'] ?? ws?.['!ref']
  if (!ws || !ref) throw new Error('the first sheet is empty')
  const full = X.utils.decode_range(ref)
  const cutRows = full.e.r - full.s.r + 1 > SHEET_ROWS
  const cutCols = full.e.c - full.s.c + 1 > SHEET_COLS
  const e = { r: Math.min(full.e.r, full.s.r + SHEET_ROWS - 1), c: Math.min(full.e.c, full.s.c + SHEET_COLS - 1) }
  const width = e.c - full.s.c + 1
  const raw = X.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: true, range: { s: full.s, e } })
  const rows = raw.slice(0, SHEET_ROWS).map((r) => Array.from({ length: width }, (_, i) => (r[i] == null ? '' : String(r[i]))))
  const cols = Array.from({ length: width }, (_, i) => X.utils.encode_col(full.s.c + i))
  return { cols, rows, cap: capLine(cutRows, cutCols) }
}

const loadSheetJs = (): Promise<X> => import('../../vendor/sheetjs/xlsx.mjs')

export function SheetView({ url }: { url: string }) {
  const [drawn, setDrawn] = useState<Drawn | null>(null)
  useEffect(() => {
    let live = true
    ;(async () => {
      const res = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' })
      if (!res.ok) throw new Error(`the file answered ${res.status}`)
      const [data, X] = await Promise.all([res.arrayBuffer(), loadSheetJs()])
      const d = drawSheet(data, X)
      if (live) setDrawn(d)
    })().catch(() => { /* The fallback line stays. */ })
    return () => { live = false }
  }, [url])

  if (!drawn) return <p className={LINE}>{FALLBACK_LINE}</p>
  return (
    <>
      <div data-sheet className="mt-[0.9rem] max-h-[30rem] overflow-auto rounded-lg border border-[color:var(--a-line)] font-mono text-[0.72rem]">
        <table className="w-full border-collapse">
          <thead>
            <tr>{drawn.cols.map((c) => <th key={c} scope="col" className={`${CELL} sticky top-0 bg-[color:var(--a-surface-strong)] font-medium text-[color:var(--a-muted)]`}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {drawn.rows.map((r, i) => (
              <tr key={i}>{r.map((v, j) => <td key={j} className={`${CELL} text-[color:var(--a-body)]`}>{v}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      {drawn.cap ? <p className={LINE}>{drawn.cap}</p> : null}
    </>
  )
}
