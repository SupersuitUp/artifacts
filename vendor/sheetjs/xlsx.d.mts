// The part of SheetJS Community Edition 0.20.3 (vendor/sheetjs/xlsx.mjs) that this package uses.
// The full types ship in the SheetJS tarball (types/index.d.ts); only these calls are made here.
export type WorkSheet = Record<string, unknown> & { '!ref'?: string; '!fullref'?: string }
export type WorkBook = { SheetNames: string[]; Sheets: Record<string, WorkSheet> }
export type Range = { s: { r: number; c: number }; e: { r: number; c: number } }
export const version: string
export function read(data: ArrayBuffer | Uint8Array, opts?: Record<string, unknown>): WorkBook
export function write(wb: WorkBook, opts: Record<string, unknown>): unknown
export const utils: {
  decode_range(ref: string): Range
  encode_col(c: number): string
  sheet_to_json(ws: WorkSheet, opts?: Record<string, unknown>): unknown[][]
  book_new(): WorkBook
  book_append_sheet(wb: WorkBook, ws: WorkSheet, name?: string): void
  aoa_to_sheet(rows: unknown[][]): WorkSheet
}
