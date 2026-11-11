// The file page's spreadsheet table (Task 25, 2026-11-11): the reader's browser fetches the signed
// URL, SheetJS reads the first sheet, and a read-only text table is drawn. Anything that fails keeps
// today's fallback line, so a bucket with no CORS rule shows the reader no change.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import * as XLSX from '../../vendor/sheetjs/xlsx.mjs'
import { SheetView, drawSheet, FALLBACK_LINE, MAX_SHEET_BYTES } from './sheet-view.js'
import { showsAsSheet } from './file-page.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function book(sheets: [string, unknown[][]][], bookType: 'xlsx' | 'ods' | 'csv' = 'xlsx'): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name)
  const out = XLSX.write(wb, { type: 'array', bookType }) as ArrayBuffer | string
  return typeof out === 'string' ? new TextEncoder().encode(out).buffer as ArrayBuffer : out
}

let root: Root | null = null
let host: HTMLElement | null = null
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; vi.unstubAllGlobals() })

async function mount(url: string, extra: { bytes?: number; load?: () => Promise<typeof XLSX> } = {}) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => { root!.render(<SheetView url={url} bytes={extra.bytes ?? 1000} load={extra.load} />) })
  // Let the fetch, the dynamic import and the parse settle.
  for (let i = 0; i < 20; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
  return host
}

const answer = (buf: ArrayBuffer) => vi.fn(async () => new Response(buf, { status: 200 }))

describe('the spreadsheet table', () => {
  it('draws the FIRST sheet of a workbook as a text table, never the second, and the fallback line goes', async () => {
    const buf = book([['Prices', [['Plan', 'Price'], ['Basic', 10], ['Pro', '<b>30</b>']]], ['Hidden', [['secret-second-sheet']]]])
    const fetcher = answer(buf)
    vi.stubGlobal('fetch', fetcher)
    const el = await mount('https://signed.example.com/model.xlsx?dl=1')
    expect(fetcher).toHaveBeenCalledWith('https://signed.example.com/model.xlsx?dl=1', expect.objectContaining({ credentials: 'omit' }))
    const table = el.querySelector('[data-sheet] table')
    expect(table).not.toBeNull()
    const cells = [...el.querySelectorAll('td')].map((td) => td.textContent)
    expect(cells).toEqual(['Plan', 'Price', 'Basic', '10', 'Pro', '<b>30</b>'])
    // Text only: the cell's markup is shown as characters, never made into an element.
    expect(el.querySelector('td b')).toBeNull()
    expect([...el.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['A', 'B'])
    expect(el.textContent).not.toContain('secret-second-sheet')
    expect(el.textContent).not.toContain(FALLBACK_LINE)
    expect(el.textContent).not.toContain('Showing the first')
  })

  it('reads .ods and .csv too', async () => {
    for (const type of ['ods', 'csv'] as const) {
      vi.stubGlobal('fetch', answer(book([['S', [['a', 'b'], ['1', '2']]]], type)))
      const el = await mount(`https://signed.example.com/x.${type}`)
      expect([...el.querySelectorAll('td')].map((td) => td.textContent), type).toEqual(['a', 'b', '1', '2'])
      act(() => root?.unmount()); host?.remove()
    }
  })

  it('says it cut the rows when the sheet has more than 500', async () => {
    const rows = Array.from({ length: 620 }, (_, i) => [`r${i + 1}`, i])
    vi.stubGlobal('fetch', answer(book([['Big', rows]])))
    const el = await mount('https://signed.example.com/big.xlsx')
    expect(el.querySelectorAll('tbody tr')).toHaveLength(500)
    expect(el.textContent).toContain('r500')
    expect(el.textContent).not.toContain('r501')
    expect(el.textContent).toContain('Showing the first 500 rows. Download it to see all of it.')
  })

  it('says it cut the columns, and both, in the same plain words', () => {
    const wide = book([['W', [Array.from({ length: 60 }, (_, i) => `c${i}`)]]])
    const d = drawSheet(wide, XLSX)
    expect(d.cols).toHaveLength(50)
    expect(d.rows[0]).toHaveLength(50)
    expect(d.cap).toBe('Showing the first 50 columns. Download it to see all of it.')
    const both = book([['B', Array.from({ length: 501 }, () => Array.from({ length: 51 }, () => 'x'))]])
    expect(drawSheet(both, XLSX).cap).toBe('Showing the first 500 rows and 50 columns. Download it to see all of it.')
  })

  it('a file that will not parse keeps the fallback line', async () => {
    // A zip signature with nothing after it: SheetJS refuses it.
    vi.stubGlobal('fetch', answer(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]).buffer))
    const el = await mount('https://signed.example.com/broken.xlsx')
    expect(el.querySelector('table')).toBeNull()
    expect(el.textContent).toContain(FALLBACK_LINE)
  })

  it('a fetch the browser refuses (no CORS rule) or a 403 keeps the fallback line', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    let el = await mount('https://signed.example.com/model.xlsx')
    expect(el.querySelector('table')).toBeNull()
    expect(el.textContent).toContain(FALLBACK_LINE)
    act(() => root?.unmount()); host?.remove()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 403 })))
    el = await mount('https://signed.example.com/model.xlsx')
    expect(el.querySelector('table')).toBeNull()
    expect(el.textContent).toContain(FALLBACK_LINE)
  })
})

describe('what the table costs the reader', () => {
  it('a file over 10 MB is never fetched: the line and Download stay', async () => {
    const fetcher = answer(book([['S', [['a']]]]))
    vi.stubGlobal('fetch', fetcher)
    const load = vi.fn(async () => XLSX)
    const el = await mount('https://signed.example.com/huge.xlsx', { bytes: MAX_SHEET_BYTES + 1, load })
    expect(MAX_SHEET_BYTES).toBe(10_000_000)
    expect(fetcher).not.toHaveBeenCalled()
    expect(load).not.toHaveBeenCalled()
    expect(el.querySelector('table')).toBeNull()
    expect(el.textContent).toContain(FALLBACK_LINE)
  })

  it('a failed fetch never loads SheetJS; a good one loads it after the fetch answers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const load = vi.fn(async () => XLSX)
    await mount('https://signed.example.com/model.xlsx', { load })
    expect(load).not.toHaveBeenCalled()
    act(() => root?.unmount()); host?.remove()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 403 })))
    await mount('https://signed.example.com/model.xlsx', { load })
    expect(load).not.toHaveBeenCalled()
    act(() => root?.unmount()); host?.remove()
    const order: string[] = []
    vi.stubGlobal('fetch', vi.fn(async () => { order.push('fetch'); return new Response(book([['S', [['a']]]]), { status: 200 }) }))
    const el = await mount('https://signed.example.com/model.xlsx', { load: vi.fn(async () => { order.push('load'); return XLSX }) })
    expect(order).toEqual(['fetch', 'load'])
    expect(el.querySelector('td')?.textContent).toBe('a')
  })
})

describe('which files are spreadsheets', () => {
  it('reads the STORED name, as fileLinks does', () => {
    const f = (name: string, ref?: string) => ({ name, bytes: 1, source: 's', type: 'x', ...(ref ? { ref } : {}) })
    expect(showsAsSheet(f('a.pdf', 'private:a.0123abcd.xlsx'))).toBe(true)
    for (const ext of ['xlsx', 'xls', 'csv', 'ods', 'XLSX']) expect(showsAsSheet(f('a', `private:a.0123abcd.${ext}`)), ext).toBe(true)
    expect(showsAsSheet(f('a.xlsx', 'private:a.0123abcd.html'))).toBe(false)
    expect(showsAsSheet(f('a.xlsx'))).toBe(false)
  })
})
