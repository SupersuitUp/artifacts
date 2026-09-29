// Recordings on personal notes for a reader who is not signed in: kept in this browser's IndexedDB
// and nowhere else, like the notes themselves (device-notes.ts). A note names its recording as
// `device/<memo>.<ext>`; on sign-in the comment layer uploads it to the reader's account and
// deletes it here. A browser without IndexedDB (or a private window that refuses it) keeps no
// recording, and nothing breaks: every call answers null or false.

const DB = 'artifact-voice'
const STORE = 'memos'

export const isDeviceAudio = (p: unknown): p is string => typeof p === 'string' && p.startsWith('device/')

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE) }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await open()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

export type DeviceAudio = {
  put(key: string, blob: Blob): Promise<boolean>
  get(key: string): Promise<Blob | null>
  remove(key: string): Promise<void>
}

export const deviceAudio: DeviceAudio = {
  put: async (key, blob) => (await run('readwrite', (s) => s.put(blob, key))) !== null,
  get: async (key) => { const b = await run<unknown>('readonly', (s) => s.get(key)); return b instanceof Blob ? b : null },
  remove: async (key) => { await run('readwrite', (s) => s.delete(key)) },
}
