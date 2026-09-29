import { describe, it, expect, beforeEach, vi } from 'vitest'
import { addDeviceNote, deviceNotes, deviceNotesKey, removeDeviceNote, replaceDeviceNote } from './device-notes.js'

const value = { anchor: { kind: 'text' as const, quote: 'river', prefix: '', suffix: '' }, body: 'on this phone', version: 1 }

// Node 25 ships its own global localStorage (inert without --localstorage-file), which shadows
// jsdom's in Vitest; a plain in-memory Storage stands in for the browser's.
function stubStorage() {
  const mem = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k), clear: () => mem.clear(), key: (i: number) => [...mem.keys()][i] ?? null,
    get length() { return mem.size },
  })
}

describe('device notes', () => {
  beforeEach(() => stubStorage())
  it('are kept in localStorage under artifact-notes:<host>:<page>', () => {
    expect(deviceNotesKey('abc23456')).toBe(`artifact-notes:${location.host}:abc23456`)
    const n = addDeviceNote('abc23456', value)
    expect(n.id).toMatch(/^d-/)
    const raw = JSON.parse(window.localStorage.getItem(deviceNotesKey('abc23456'))!)
    expect(raw).toEqual([{ id: n.id, value, at: n.at }])
    expect(deviceNotes('abc23456')).toEqual([n])
    expect(deviceNotes('def23456')).toEqual([])
  })
  it('edit and delete by id', () => {
    const n = addDeviceNote('abc23456', value)
    replaceDeviceNote('abc23456', n.id, { ...value, body: 'edited' })
    expect(deviceNotes('abc23456')[0].value.body).toBe('edited')
    removeDeviceNote('abc23456', n.id)
    expect(deviceNotes('abc23456')).toEqual([])
  })
  it('a corrupt or foreign value reads as no notes, never an error', () => {
    window.localStorage.setItem(deviceNotesKey('abc23456'), '{not json')
    expect(deviceNotes('abc23456')).toEqual([])
    window.localStorage.setItem(deviceNotesKey('abc23456'), JSON.stringify([{ id: 1 }, { id: 'd-x', value: { body: 'x' }, at: 'now' }]))
    expect(deviceNotes('abc23456').map((n) => n.id)).toEqual(['d-x'])
  })
})
