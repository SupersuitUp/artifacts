import { deviceAudio, isDeviceAudio } from './device-audio.js'

describe('device audio', () => {
  it('names only device recordings as its own', () => {
    expect(isDeviceAudio('device/abc.webm')).toBe(true)
    expect(isDeviceAudio('comments/abc.webm')).toBe(false)
    expect(isDeviceAudio(undefined)).toBe(false)
  })
  it('a browser with no IndexedDB keeps nothing and breaks nothing', async () => {
    vi.stubGlobal('indexedDB', undefined)
    try {
      expect(await deviceAudio.put('device/a.webm', new Blob(['x']))).toBe(false)
      expect(await deviceAudio.get('device/a.webm')).toBeNull()
      await expect(deviceAudio.remove('device/a.webm')).resolves.toBeUndefined()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
